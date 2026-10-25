/**
 * B15's composer and request parser (lib/summaryStore.js), pure.
 *
 * DRIFT. The record line builders the server uses are transcribed from
 * components/homeguard/SummaryWorkspace.tsx. This file cuts those exact
 * functions out of the TSX in this tree, compiles them with TypeScript, and
 * runs both copies over the same records and selections: a change on the
 * client fails here until it is copied to the server. The labels, purposes,
 * household categories and result qualifiers are compared with the client's
 * own modules and source the same way.
 *
 * Every composed snapshot is checked with the client's own
 * `validSummarySnapshot` (lib/frontend/production/summary-service.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadFrontend } from './frontend-test-loader.mjs';
import {
  CATEGORY_LABELS, EMPTY_SECTION_LINE, LIMITS, PURPOSES, REFUSALS, RESULT_QUALIFIERS, SECTION_LABELS, UNAVAILABLE_SECTION_LINE,
  categoryLabels, composeSummary, parseSummaryRequest, recordDate, recordDescription, recordDetails, requestedRecordsCurrent, resultLines,
  FACTOR_KEYS, factorAppendixDetail, factorLine, scoreClosingLine, scoreLine,
} from '../lib/summaryStore.js';
import { RETRIEVED_AT, WELL_PROFILE, dailyPayload, stageFor } from './helpers/summaryEvidenceFixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = readFileSync(path.join(ROOT, 'components/homeguard/SummaryWorkspace.tsx'), 'utf8');
const { validSummarySnapshot } = await loadFrontend('production/summary-service');
const { resultQualifiers } = await loadFrontend('home-test-preview');
const { homeMemberKeys, memberCatalog } = await loadFrontend('home-household');
const { defaultSummarySelection } = await loadFrontend('home-maintenance-preview');

/** The client's own builders, cut out of the TSX and compiled. */
async function clientBuilders() {
  const start = TSX.indexOf('const sectionLabels');
  const end = TSX.indexOf('export default function SummaryWorkspace');
  assert.ok(start > 0 && end > start, 'SummaryWorkspace.tsx no longer has its helpers where the drift test looks');
  const helpers = TSX.slice(start, end);
  const open = 'const lines = records.flatMap(record => {';
  const close = 'return details;';
  const from = TSX.indexOf(open);
  const to = TSX.indexOf(close, from);
  assert.ok(from > 0 && to > from, 'SummaryWorkspace.tsx no longer builds record lines where the drift test looks');
  const body = TSX.slice(from + open.length, to);
  const source = [
    `const resultQualifiers = ${JSON.stringify(resultQualifiers)};`,
    'type SummaryRecord = { id: string; title: string; revision?: number; [key: string]: unknown };',
    'type SummarySection = string;',
    helpers,
    `function recordDetails(section: string, record: SummaryRecord, selection: any) {${body} return details; }`,
    'export { sectionLabels, recordSections, recordDate, recordDescription, resultLines, recordDetails, scoreClosingLine, scoreLine, factorLine, factorAppendixDetail };',
  ].join('\n');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}
const client = await clientBuilders();

const selectionWith = (over = {}) => ({ ...defaultSummarySelection, start: '2026-01-01', end: '2026-12-31', ...over, sections: { ...defaultSummarySelection.sections, ...(over.sections ?? {}) } });

const CORPUS = {
  tests: [
    { id: 't1', title: 'Kitchen tap', revision: 3, medium: 'water', method: 'EPA 533', collectionStart: '2026-03-01', collectionEnd: '2026-03-02', review: 'user_confirmed', reviewReason: 'Checked twice.', status: 'resulted', contextId: 'home-1', sampleLabel: 'Kitchen', note: 'PRIVATE note on the tap', attachments: [{ id: 'a', name: 'report.jpg' }],
      rows: [
        { analyte: 'PFOA', qualifier: 'measured', originalValue: '4.1', originalUnit: 'ng/L', limit: '2', limitUnit: 'ng/L', basis: '', reportDate: '2026-03-10' },
        { analyte: '', qualifier: 'non_detect', originalValue: '', originalUnit: '', limit: '2', limitUnit: '', basis: 'dry', reportDate: '' },
        { analyte: 'Lead', qualifier: 'odd-qualifier', originalValue: '0', originalUnit: 'ug/L' },
        null,
      ] },
    { id: 't2', title: 'Garden soil', revision: 1, medium: 'soil', review: 'unknown-review', rows: [{ analyte: 'Lead', qualifier: 'less_than', originalValue: '5' }] },
    { id: 't3', title: 'Planned', revision: 1, plannedDate: '2026-11-01', rows: 'not-an-array' },
  ],
  maintenance: [
    { id: 'm1', title: 'Filter', revision: 2, status: 'active', nextDue: '2026-11-01', snoozedUntil: '2026-11-08', lastCompleted: '2026-05-01', installed: '2025-01-01', history: [{ kind: 'serviced', date: '2026-05-01', due: '2026-11-01', note: 'PRIVATE swapped it' }, { kind: 'installed', date: '2025-01-01' }, 'junk'] },
    { id: 'm2', title: 'Dehumidifier', revision: 1 },
  ],
  observations: [
    { id: 'o1', title: 'Damp corner', revision: 1, observedAt: '2026-04-04T10:00:00Z', reading: 62, unit: '%', room: 'Basement', note: 'PRIVATE smell', photoName: 'corner.jpg', photoData: 'data:image/png;base64,SECRETBYTES' },
    { id: 'o2', title: 'Reading zero', revision: 1, reading: 0, unit: '' },
  ],
  gardens: [{ id: 'g1', title: 'Raised bed', revision: 1, irrigation: 'rain', county: 'Wake', privateNote: 'PRIVATE soil worry' }],
  actions: [{ id: 'x1', title: 'Run the fan', revision: 4, state: 'saved', date: '2026-10-15' }, { id: 'x2', title: 'Undated task', revision: 1, state: 'waiting', date: '' }],
};
const SCOPES = [{}, { location: true }, { notes: true }, { attachments: true }, { appendix: true }, { location: true, notes: true, attachments: true, appendix: true }];

test('drift: the server\'s record line builders produce exactly the client\'s own output, record by record and scope by scope', () => {
  let compared = 0;
  for (const [section, records] of Object.entries(CORPUS)) {
    for (const record of records) {
      assert.equal(recordDate(record), client.recordDate(record), `${section}/${record.id} recordDate`);
      assert.equal(recordDescription(record), client.recordDescription(record), `${section}/${record.id} recordDescription`);
      assert.deepEqual(resultLines(record), client.resultLines(record), `${section}/${record.id} resultLines`);
      for (const scope of SCOPES) {
        const selection = { ...selectionWith(), ...scope };
        assert.deepEqual(recordDetails(section, record, selection), client.recordDetails(section, record, selection), `${section}/${record.id} ${JSON.stringify(scope)}`);
        compared += 1;
      }
    }
  }
  assert.ok(compared >= 60);
});

test('drift: labels, record sections, purposes, household categories and result qualifiers match the client', () => {
  assert.deepEqual({ ...SECTION_LABELS }, client.sectionLabels);
  assert.deepEqual(client.recordSections, ['tests', 'actions', 'maintenance', 'observations', 'gardens']);
  const purposeLine = TSX.split('\n').find((line) => line.includes('What is this summary for?'));
  assert.deepEqual([...purposeLine.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]), [...PURPOSES]);
  assert.equal(defaultSummarySelection.purpose, PURPOSES[0]);
  assert.deepEqual(CATEGORY_LABELS.map((pair) => [...pair]), homeMemberKeys.map((key) => [memberCatalog[key].band, memberCatalog[key].label]));
  assert.deepEqual({ ...RESULT_QUALIFIERS }, resultQualifiers);
  assert.ok(TSX.includes(`'${EMPTY_SECTION_LINE}'`), 'the empty-section sentence');
  assert.ok(TSX.includes(`'${UNAVAILABLE_SECTION_LINE}'`), 'the unavailable-section sentence');
});

test('the server builders never find an inherited property for a stored value like constructor', () => {
  const record = { id: 't', title: 'T', revision: 1, review: 'constructor', rows: [{ qualifier: 'toString' }] };
  assert.match(recordDetails('tests', record, selectionWith())[2], /^Transcription review: Not supplied\./);
  assert.ok(!resultLines(record)[0].includes('function'));
});

// ---------------------------------------------------------------------------
// composeSummary
// ---------------------------------------------------------------------------

const NOW = '2026-10-20T12:00:00.000Z';
const HOME = { id: 'c0c0c0c0-0000-4000-8000-000000000001', county: 'Wake County', state: 'NC', water_source: 'Well', lat: 35.12345, lng: -78.98765 };
const all = (over = {}) => ({ id: '5a3a0000-0000-4000-8000-000000000001', createdAt: NOW, home: HOME, categories: [], ...over });
const requested = (sources, kinds = Object.keys(sources)) => kinds.flatMap((kind) => (sources[kind] ?? []).map((row) => ({ kind, id: row.id, revision: row.revision })));
const texts = (summary) => JSON.stringify(summary);

test('the default selection (scores and factors) with no evidence read says both sections were unavailable, never that they were included', () => {
  const selection = selectionWith();
  const out = composeSummary(all({ selection, records: [], sources: {} }));
  assert.equal(out.ok, true);
  const snapshot = { ...out.summary, revision: 1 };
  assert.equal(validSummarySnapshot(snapshot), true);
  assert.deepEqual(out.summary.report.sections.map((s) => s.title), ['Two score snapshot', 'Seven factors, with their original dates', 'Omissions and scope']);
  assert.deepEqual(out.summary.report.sections[0].lines, [UNAVAILABLE_SECTION_LINE]);
  assert.deepEqual(out.summary.report.sections[1].lines, [UNAVAILABLE_SECTION_LINE]);
  assert.deepEqual(out.summary.report.introduction, [
    'Purpose: Household review.',
    `Generated: ${NOW}. Selected private-record dates: 2026-01-01 through 2026-12-31. Existing environmental observations retain their original dates even when older than this range.`,
    'Water context: Private well, no inferred utility match.',
  ]);
  const scope = out.summary.report.sections.at(-1).lines;
  assert.equal(scope[0], 'Selected sections: Today & Homeguard scores; Factors & sources. Included: none.');
  assert.equal(scope[1], 'Selected but unavailable when this summary was prepared: Today & Homeguard scores; Factors & sources.');
  assert.ok(out.summary.omissions.includes('Today & Homeguard scores were unavailable when this summary was prepared.'));
  assert.ok(out.summary.omissions.includes('Factors & sources were unavailable when this summary was prepared.'));
  assert.ok(!texts(out.summary).includes('not included in saved summaries yet'));
  assert.ok(out.summary.omissions.includes('Test reports were not selected.'));
  assert.ok(out.summary.omissions.includes('Original attachment contents and metadata are never included.'));
  assert.deepEqual(out.summary.manifest, []);
  assert.equal(out.summary.homeContextId, HOME.id);
  assert.equal(out.summary.title, 'Household review');
});

test('records: only the selected ones, in stored order, with a manifest of their revisions and own dates', () => {
  const selection = selectionWith({ sections: { scores: false, factors: false, tests: true, maintenance: true, observations: true, gardens: true, actions: true } });
  const sources = CORPUS;
  const records = [{ kind: 'observations', id: 'o1', revision: 1 }, { kind: 'tests', id: 't3', revision: 1 }, { kind: 'tests', id: 't1', revision: 3 }, { kind: 'actions', id: 'x2', revision: 1 }];
  const out = composeSummary(all({ selection, records, sources }));
  assert.equal(out.ok, true);
  assert.deepEqual(out.summary.manifest, [
    { kind: 'tests', id: 't1', revision: 3, asOf: '2026-03-01' },
    { kind: 'tests', id: 't3', revision: 1, asOf: '2026-11-01' },
    { kind: 'actions', id: 'x2', revision: 1, asOf: null },
    { kind: 'observations', id: 'o1', revision: 1, asOf: '2026-04-04T10:00:00Z' },
  ]);
  const byTitle = Object.fromEntries(out.summary.report.sections.map((s) => [s.title, s.lines]));
  assert.ok(byTitle['Test reports'][0].startsWith('Kitchen tap: resulted · 2026-03-01 · User-reported record, revision 3.'));
  assert.deepEqual(byTitle['Maintenance records'], [EMPTY_SECTION_LINE], 'a selected section with no selected record says so');
  assert.deepEqual(byTitle['Garden records'], [EMPTY_SECTION_LINE]);
  assert.equal(validSummarySnapshot({ ...out.summary, revision: 1 }), true);
});

test('private text: notes, place labels, categories and attachment names only when chosen; photo data and coordinates never', () => {
  const selection = selectionWith({ sections: { scores: false, factors: false, tests: true, observations: true, gardens: true } });
  const sources = { tests: CORPUS.tests, observations: CORPUS.observations, gardens: CORPUS.gardens };
  const records = requested(sources);
  const closed = composeSummary(all({ selection, records, sources, categories: ['Pregnancy'] }));
  const closedText = texts(closed.summary);
  for (const marker of ['PRIVATE', 'corner.jpg', 'Basement', 'Kitchen.', 'Pregnancy', 'Wake County', 'home-1']) assert.ok(!closedText.includes(marker), `${marker} without opting in`);
  const open = composeSummary(all({ selection: { ...selection, notes: true, location: true, attachments: true, categories: true }, records, sources, categories: categoryLabels({ has_pregnant: true, has_senior: true }) }));
  const openText = texts(open.summary);
  for (const marker of ['PRIVATE note on the tap', 'PRIVATE smell', 'PRIVATE soil worry', 'corner.jpg', 'Included place label: Basement.', 'Older adults, Pregnancy', 'Selected area: Wake County, NC. No street address or device location included.', '1 attachment reference(s).']) {
    assert.ok(openText.includes(marker), marker);
  }
  for (const marker of ['SECRETBYTES', 'data:image', '35.12345', '78.98765', 'report.jpg']) {
    assert.ok(!openText.includes(marker) && !closedText.includes(marker), `${marker} is never included`);
  }
  assert.equal(validSummarySnapshot({ ...open.summary, revision: 1 }), true);
});

test('an unavailable section (tasks off) is saved as unavailable and disclosed, and nothing of it reaches the manifest', () => {
  const selection = selectionWith({ sections: { scores: false, factors: false, actions: true } });
  const out = composeSummary(all({ selection, records: [{ kind: 'actions', id: 'x1', revision: 4 }], sources: { actions: null } }));
  assert.deepEqual(out.summary.report.sections[0], { title: 'Saved actions', lines: [UNAVAILABLE_SECTION_LINE] });
  assert.ok(out.summary.omissions.includes('Saved actions were unavailable when this summary was prepared.'));
  assert.deepEqual(out.summary.manifest, []);
  assert.equal(requestedRecordsCurrent([{ kind: 'actions', id: 'x1', revision: 99 }], { actions: null }), true, 'an unavailable section is not checked');
});

test('a very long line is shortened and disclosed, so no line can fail the client\'s 30,000-character check', () => {
  const long = `${'a'.repeat(LIMITS.lineLength - 1)}\u{1F600}${'b'.repeat(15000)}`;
  const selection = selectionWith({ sections: { scores: false, factors: false, observations: true }, notes: true });
  const sources = { observations: [{ id: 'o', title: 'Long', revision: 1, note: long }] };
  const out = composeSummary(all({ selection, records: requested(sources), sources }));
  assert.equal(out.ok, true);
  const lines = out.summary.report.sections.flatMap((s) => s.lines);
  assert.ok(lines.every((line) => line.length <= 30000));
  assert.ok(lines.some((line) => line.endsWith(' (shortened)')));
  assert.ok(!lines.some((line) => /[\ud800-\udbff](?![\udc00-\udfff])/.test(line)), 'no lone surrogate');
  assert.ok(out.summary.omissions.includes('Some long text was shortened to fit this summary.'));
  assert.equal(validSummarySnapshot({ ...out.summary, revision: 1 }), true);
});

test('too large: more lines than a section may hold, or a snapshot over 2,000,000 bytes, is refused', () => {
  const selection = selectionWith({ sections: { scores: false, factors: false, tests: true } });
  const rows = Array.from({ length: 2600 }, (_, n) => ({ analyte: `A${n}` }));
  const sources = { tests: [{ id: 't', title: 'Many', revision: 1, rows }, { id: 'u', title: 'More', revision: 1, rows }] };
  assert.deepEqual(composeSummary(all({ selection, records: requested(sources), sources })), { ok: false, reason: 'too_large' });
  const big = { observations: Array.from({ length: 120 }, (_, n) => ({ id: `o${n}`, title: 'Big', revision: 1, note: 'x'.repeat(19000) })) };
  const out = composeSummary(all({ selection: selectionWith({ sections: { scores: false, factors: false, observations: true }, notes: true }), records: requested(big), sources: big }));
  assert.deepEqual(out, { ok: false, reason: 'too_large' });
});

test('requestedRecordsCurrent: an exact id and revision, nothing else', () => {
  const sources = { tests: [{ id: 't1', revision: 2 }] };
  assert.equal(requestedRecordsCurrent([{ kind: 'tests', id: 't1', revision: 2 }], sources), true);
  assert.equal(requestedRecordsCurrent([{ kind: 'tests', id: 't1', revision: 1 }], sources), false);
  assert.equal(requestedRecordsCurrent([{ kind: 'tests', id: 'other', revision: 2 }], sources), false);
});

test('no server sentence carries U+2014', () => {
  const source = readFileSync(path.join(ROOT, 'lib/summaryStore.js'), 'utf8');
  assert.ok(!source.includes('—'));
  for (const route of ['app/api/summaries/route.js', 'app/api/summaries/detail/route.js']) assert.ok(!readFileSync(path.join(ROOT, route), 'utf8').includes('—'), route);
  assert.ok(Object.values(REFUSALS).every((message) => !message.includes('—')));
});

// ---------------------------------------------------------------------------
// parseSummaryRequest
// ---------------------------------------------------------------------------

const goodBody = (over = {}) => ({ selection: selectionWith({ sections: { tests: true } }), records: [{ kind: 'tests', id: 't1', revision: 1 }], collectionRevisions: { tests: undefined }, homeContextId: HOME.id, ...over });
const field = (out) => (out.ok ? null : out.fieldErrors[0].field);

test('parseSummaryRequest accepts the screen\'s own body and rebuilds the selection from its known keys', () => {
  const out = parseSummaryRequest({ ...goodBody(), selection: { ...goodBody().selection, extra: 'dropped' } });
  assert.equal(out.ok, true);
  assert.ok(!('extra' in out.value.selection));
  assert.deepEqual(Object.keys(out.value.selection), ['purpose', 'start', 'end', 'sections', 'categories', 'location', 'notes', 'attachments', 'appendix', 'excluded']);
  assert.equal(parseSummaryRequest({ selection: selectionWith() }).ok, true, 'records and homeContextId may be absent');
});

test('parseSummaryRequest refuses what the screen never sends', () => {
  const sel = goodBody().selection;
  const cases = [
    [null, 'body'], [[], 'body'], [{}, 'selection'],
    [goodBody({ selection: { ...sel, purpose: 'My own words' } }), 'selection.purpose'],
    [goodBody({ selection: { ...sel, start: '2026-02-30' } }), 'selection.start'],
    [goodBody({ selection: { ...sel, start: '2026-12-31', end: '2026-01-01' } }), 'selection.end'],
    [goodBody({ selection: { ...sel, sections: { ...sel.sections, gardens: 'yes' } } }), 'selection.sections'],
    [goodBody({ selection: { ...sel, sections: Object.fromEntries(Object.keys(sel.sections).map((k) => [k, false])) }, records: [] }), 'selection.sections'],
    [goodBody({ selection: { ...sel, notes: 1 } }), 'selection.notes'],
    [goodBody({ selection: { ...sel, excluded: ['nope'] } }), 'selection.excluded'],
    [goodBody({ selection: { ...sel, excluded: ['tests:'] } }), 'selection.excluded'],
    [goodBody({ selection: { ...sel, excluded: Array.from({ length: 5001 }, (_, n) => `tests:${n}`) } }), 'selection.excluded'],
    [goodBody({ records: [{ kind: 'notes', id: 'x', revision: 1 }] }), 'records'],
    [goodBody({ records: [{ kind: 'gardens', id: 'x', revision: 1 }] }), 'records'],
    [goodBody({ records: [{ kind: 'tests', id: 't1' }] }), 'records'],
    [goodBody({ records: [{ kind: 'tests', id: 't1', revision: 0 }] }), 'records'],
    [goodBody({ records: [{ kind: 'tests', id: '', revision: 1 }] }), 'records'],
    [goodBody({ records: [{ kind: 'tests', id: 'a\nb', revision: 1 }] }), 'records'],
    [goodBody({ records: [{ kind: 'tests', id: 't1', revision: 1 }, { kind: 'tests', id: 't1', revision: 1 }] }), 'records'],
    [goodBody({ records: Array.from({ length: 501 }, (_, n) => ({ kind: 'tests', id: `t${n}`, revision: 1 })) }), 'records'],
    [goodBody({ collectionRevisions: [] }), 'collectionRevisions'],
    [goodBody({ homeContextId: 7 }), 'homeContextId'],
  ];
  for (const [body, expected] of cases) assert.equal(field(parseSummaryRequest(body)), expected, JSON.stringify(body)?.slice(0, 120));
});

// ---------------------------------------------------------------------------
// Scores and factors (Ruling S15-6 as revised): the screens' StageData, frozen
// ---------------------------------------------------------------------------

const STAGES = {
  public: await stageFor(),
  well: await stageFor({ profileRow: WELL_PROFILE }),
  noToday: await stageFor({ daily: null }),
  noHome: await stageFor({ home: null }),
  earlierHome: await stageFor({ daily: { ...dailyPayload(), home_context_id: 'an-earlier-home' } }),
};

test('drift: the server\'s score, factor and appendix lines are the client\'s own, for every evidence state', () => {
  assert.equal(scoreClosingLine, client.scoreClosingLine);
  assert.deepEqual([...FACTOR_KEYS], ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead']);
  for (const [name, stage] of Object.entries(STAGES)) {
    for (const home of [false, true]) {
      for (const preview of [false, true]) {
        const score = home ? stage.home : stage.today;
        assert.equal(scoreLine(home, score, preview), client.scoreLine(home, score, preview), `${name} score ${home} ${preview}`);
      }
    }
    for (const key of FACTOR_KEYS) {
      for (const missing of [false, true]) {
        for (const privateWater of [false, true]) {
          assert.equal(factorLine(key, stage.readings[key], missing, privateWater), client.factorLine(key, stage.readings[key], missing, privateWater), `${name} ${key}`);
          assert.equal(factorAppendixDetail(key, stage.readings[key], missing, privateWater), client.factorAppendixDetail(key, stage.readings[key], missing, privateWater), `${name} ${key} appendix`);
        }
      }
    }
  }
});

test('selected scores and factors are composed from the evidence with their source dates, and the report says both were included', () => {
  const selection = selectionWith({ appendix: true });
  const stage = STAGES.public;
  const out = composeSummary(all({ selection, records: [], sources: {}, home: { ...HOME, water_source: 'utility' }, evidence: { data: stage } }));
  assert.equal(out.ok, true);
  assert.equal(validSummarySnapshot({ ...out.summary, revision: 1 }), true);
  const byTitle = Object.fromEntries(out.summary.report.sections.map((s) => [s.title, s.lines]));
  const scores = byTitle['Two score snapshot'];
  assert.equal(typeof stage.today.score, 'number');
  assert.equal(typeof stage.home.score, 'number');
  assert.equal(scores[0], `Today: ${stage.today.score} / 100 · ${stage.today.partial ? 'Partial · ' : ''}${stage.today.severity} · ${stage.today.asOf}.`);
  assert.match(scores[0], /Oct 20/, 'Today keeps the reading\'s retrieval date');
  assert.match(scores[1], new RegExp(`^Homeguard: ${stage.home.score} / 100`));
  assert.equal(scores[2], scoreClosingLine);
  const factors = byTitle['Seven factors, with their original dates'];
  assert.equal(factors.length, 7);
  assert.match(factors[0], /^Air quality: 42 AQI · good · measured\. Source: AirNow\. Original observation or classification date: Oct 20/);
  assert.match(factors[4], /^PFAS in water: .* Source: EPA UCMR 5, Example County Water\. Original observation or classification date: Sample collected Mar 14, 2024\./);
  assert.match(factors[5], /^Radon: Zone 2 County estimate/);
  assert.match(factors[6], /^Lead in plumbing: 1962 Home built/);
  assert.equal(byTitle['Evidence appendix'].length, 8);
  assert.equal(byTitle['Evidence appendix'][0], `Air quality: ${stage.readings.air.detail}`);
  const scope = byTitle['Omissions and scope'];
  assert.equal(scope[0], 'Selected sections: Today & Homeguard scores; Factors & sources. Included: Today & Homeguard scores; Factors & sources.');
  assert.ok(!scope.some((line) => line.startsWith('Selected but unavailable')));
  assert.ok(!out.summary.omissions.some((line) => /Today & Homeguard scores|Factors & sources/.test(line)), 'no omission for an included section');
  assert.ok(!texts(out.summary).includes('—'));
  assert.deepEqual(out.summary.manifest, [], 'evidence is dated in its lines; the manifest names records only');
});

test('a private well: Homeguard has no score and PFAS says the utility result does not apply, as the screen says', () => {
  const selection = selectionWith({ appendix: true });
  const out = composeSummary(all({ selection, records: [], sources: {}, evidence: { data: STAGES.well } }));
  const byTitle = Object.fromEntries(out.summary.report.sections.map((s) => [s.title, s.lines]));
  assert.equal(byTitle['Two score snapshot'][1], 'Homeguard: unavailable for the current home. No score is inferred.');
  assert.match(byTitle['Two score snapshot'][0], /^Today: \d+ \/ 100/);
  assert.match(byTitle['Seven factors, with their original dates'][4], /^PFAS in water: missing household measurement\. Private well or spring; the utility result does not apply\./);
  assert.equal(byTitle['Evidence appendix'][4], 'PFAS in water: No applicable household water measurement.');
});

test('no reading today, or a reading from an earlier home, is said to be unavailable; nothing is inferred or reused', () => {
  for (const stage of [STAGES.noToday, STAGES.earlierHome]) {
    const out = composeSummary(all({ selection: selectionWith(), records: [], sources: {}, home: { ...HOME, water_source: 'utility' }, evidence: { data: stage } }));
    const lines = out.summary.report.sections[0].lines;
    assert.equal(lines[0], 'Today: unavailable for the current home. No score is inferred.');
    assert.match(lines[1], /^Homeguard: \d+ \/ 100/);
    assert.match(out.summary.report.sections[1].lines[0], /^Air quality: No data AQI · no data · source supplied\. Source: Source unavailable\. Original observation or classification date: Update time unavailable\./);
  }
  const noHome = composeSummary(all({ selection: selectionWith(), records: [], sources: {}, evidence: { data: STAGES.noHome } }));
  assert.equal(noHome.summary.report.sections[0].lines[1], 'Homeguard: unavailable for the current home. No score is inferred.');
  assert.ok(RETRIEVED_AT.startsWith('2026-10-20'));
});

test('an evidence object that is not StageData marks both sections unavailable rather than throwing or guessing', () => {
  const emptyReadings = Object.fromEntries(FACTOR_KEYS.map((key) => [key, {}]));
  for (const evidence of [null, {}, { data: {} }, { data: { today: {}, home: {}, readings: { air: {} } } }, { data: { today: {}, home: {}, readings: emptyReadings } }, { data: { ...STAGES.public, today: { severity: 'good' } } }]) {
    const out = composeSummary(all({ selection: selectionWith(), records: [], sources: {}, evidence }));
    assert.equal(out.ok, true);
    assert.deepEqual(out.summary.report.sections[0].lines, [UNAVAILABLE_SECTION_LINE]);
    assert.ok(out.summary.omissions.includes('Today & Homeguard scores were unavailable when this summary was prepared.'));
  }
});
