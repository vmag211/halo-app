/**
 * lib/workspaceRecords.js against the client's own compiled modules (the B11
 * drift test). The server stores a record only when its transcription of
 * `validProductionRecord` accepts it, so it must agree with the client's
 * (lib/frontend/production/home-records.ts) on every input, or a stored row
 * would make the provider discard a whole collection
 * (HomeWorkspaceState.tsx:107). The corpus is every stored collection's valid
 * sample plus, for every key, the key removed and set to each of a set of
 * wrong values, and the same for nested rows; the two must answer alike on
 * every one, and the corpus must hold both answers so it proves something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
import * as server from '../lib/workspaceRecords.js';
import { sampleRecord } from './helpers/workspaceWorld.mjs';

const records = await loadFrontend('production/home-records');
const service = await loadFrontend('production/home-service');
const explore = await loadFrontend('production/explore-service');

const COLLECTIONS = [
  'tests', 'assets', 'observations', 'gardens', 'usage', 'pantryItems', 'foodQuestions', 'fishNotes', 'foodFollows',
  'growerInquiries', 'exploreNotes', 'exploreOutcomes', 'exploreProjects', 'exploreEngagements',
];
const EXTRA = {
  homeTransitions: { id: 'h1', title: 'Moved', revision: 1, previousId: '', area: 'Raleigh', confirmedAt: '2026-10-01T12:00:00Z', readings: 'unavailable', portableIds: [] },
  weekJournal: { id: 'j1', title: 'Today', revision: 1, band: 'household', severity: '', note: '', date: '2026-10-01', fine: true, symptoms: [], illness: false, recalled: false },
};

const WRONG = [undefined, null, 0, -1, 1.5, '', 'x', '2026-02-30', 'not-a-date', 'x'.repeat(30001), [], ['x'], {}, true, false];

/** Every variant of `value` with one key removed or replaced, recursing into objects and the first element of arrays. */
function* variants(value, depth = 0) {
  if (depth > 3 || !value || typeof value !== 'object') return;
  const entries = Array.isArray(value) ? (value.length ? [[0, value[0]]] : []) : Object.entries(value);
  for (const [key, inner] of entries) {
    for (const wrong of WRONG) {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      if (wrong === undefined && !Array.isArray(copy)) delete copy[key];
      else copy[key] = wrong;
      yield copy;
    }
    for (const nested of variants(inner, depth + 1)) {
      const copy = Array.isArray(value) ? [...value] : { ...value };
      copy[key] = nested;
      yield copy;
    }
  }
}

/** A sample with nested rows, so the nested checks are reached. */
function rich(collection) {
  const record = { ...sampleRecord(collection, { homeContextId: 'home-1' }), revision: 1 };
  if (collection === 'tests') {
    const row = { id: 'r1', analyte: 'PFOA', originalValue: '4', originalUnit: 'ng/L', limit: '4', limitUnit: 'ng/L', basis: 'MCL', reportReference: 'p1', reportDate: '2026-10-01', qualifier: 'measured' };
    Object.assign(record, { rows: [row], history: [{ date: '2026-10-01', reason: 'typo', revision: 1, rows: [row], review: 'unreviewed' }], contextSnapshot: { label: 'Home', revision: 1 } });
  }
  if (collection === 'assets') record.history = [{ id: 'e1', kind: 'serviced', date: '2026-10-01', due: '2027-04-01', note: '' }];
  if (collection === 'gardens') Object.assign(record, { testIds: ['t1'], history: [{ date: '2026-10-01', irrigation: 'rain', soil: '', revision: 1 }] });
  if (collection === 'exploreNotes') Object.assign(record, { evidence: [{ recordId: 'x', title: 't', layer: 'air', scope: 'home', observedAt: null }], handoff: { id: 'h', preparedAt: '2026-10-01', body: 'b', sourceRevision: 1, scope: { place: true, evidence: false, photo: false } } });
  if (collection === 'exploreProjects') record.stepNotes = { 'step-1': 'dug' };
  if (collection === 'fishNotes') record.history = [{ date: '2026-10-01', revision: 1, original: { waterbody: 'w', species: 's', quantity: '1', unit: 'meal', note: '', timezone: 'UTC', advisoryId: 'a', date: '2026-09-30' } }];
  return record;
}

test('drift: the server copy of validProductionRecord answers exactly as the client\'s on every corpus input', () => {
  let accepted = 0;
  let refused = 0;
  const all = [...COLLECTIONS.map((name) => [name, rich(name)]), ...Object.entries(EXTRA)];
  for (const [collection, sample] of all) {
    assert.equal(records.validProductionRecord(collection, sample), true, `${collection}: the sample itself is valid for the client`);
    for (const candidate of [sample, ...variants(sample)]) {
      for (const name of [collection, 'unknownCollection']) {
        const client = records.validProductionRecord(name, candidate);
        assert.equal(server.validProductionRecord(name, candidate), client, `${name}: ${JSON.stringify(candidate).slice(0, 300)}`);
        if (client) accepted += 1; else refused += 1;
      }
    }
  }
  assert.ok(accepted > 200 && refused > 2000, `a corpus with both answers (${accepted} accepted, ${refused} refused)`);
});

test('drift: validProductionCollection, validHomeRecords, validHomeChanges, validProjectGuide and safeSourceUrl agree with the client', () => {
  const rows = [rich('tests'), { ...rich('tests'), id: 'other' }];
  for (const candidate of [rows, [rows[0], rows[0]], [], [{ ...rows[0], revision: 0 }], 'x', null]) {
    assert.equal(server.validProductionCollection('tests', candidate), records.validProductionCollection('tests', candidate));
    assert.equal(server.validHomeRecords(candidate), service.validHomeRecords(candidate));
  }
  for (const candidate of [{ tests: rows }, { '../x': rows }, { tests: 'x' }, [], null, {}]) assert.equal(server.validHomeChanges(candidate), service.validHomeChanges(candidate));
  const guide = rich('exploreProjects').guide;
  for (const candidate of [guide, ...variants(guide)]) assert.equal(server.validProjectGuide(candidate), explore.validProjectGuide(candidate));
  for (const url of ['https://example.org', 'http://example.org', 'https://user:pw@example.org', 'javascript:alert(1)', '', 3, 'https://x.org/' + 'a'.repeat(3000)]) {
    assert.equal(server.safeSourceUrl(url), explore.safeSourceUrl(url), String(url).slice(0, 40));
  }
});

test('the transcription cites its sources and carries no em dash', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../lib/workspaceRecords.js', import.meta.url), 'utf8');
  for (const cite of ['F: lib/frontend/production/explore-service.ts', 'F: lib/frontend/production/home-service.ts', 'F: lib/frontend/production/home-records.ts']) assert.ok(source.includes(cite), cite);
  assert.ok(!source.includes(String.fromCharCode(0x2014)));
});
