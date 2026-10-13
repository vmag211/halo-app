import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-test-loader.mjs';

const { validHomeRecords, validHomeChanges, acceptedHomeReceipt, homeReceiptCoversCommand } = await loadFrontend('production/home-service');
const { safePublicUrl, validFishCatalogue, validFoodNotices, validGrowerResources, validWaterStewardship, validPublishedFoodEvidence } = await loadFrontend('production/home-resources');
const { evidenceForFood } = await loadFrontend('food-evidence');
const row = { id: 'owned-test', title: 'My report', revision: 4 };
const receipt = changes => ({ operationId: 'operation-1', status: 'succeeded', changes });

test('owned collection boundary requires positive safe revisions and unique IDs', () => {
  assert.equal(validHomeRecords([row]), true);
  assert.equal(validHomeRecords([]), true);
  for (const invalid of [null, {}, [row, row], [{ ...row, revision: 0 }], [{ ...row, revision: NaN }], [{ ...row, id: '' }], [{ ...row, title: null }]]) assert.equal(validHomeRecords(invalid), false);
  assert.equal(validHomeChanges({ tests: [row], gardens: [] }), true);
  assert.equal(validHomeChanges({ '../other-owner': [row] }), false);
});

test('successful writes require operation identity and canonical advancing record', () => {
  const command = { operationId: 'operation-1', kind: 'write', collection: 'tests', record: { ...row, revision: 3 }, expectedRevision: 3 };
  assert.equal(homeReceiptCoversCommand(command, receipt({ tests: [row] })), true);
  for (const response of [receipt({}), receipt({ tests: [] }), receipt({ tests: [{ ...row, revision: 3 }] }), { ...receipt({ tests: [row] }), operationId: 'someone-else' }]) assert.equal(homeReceiptCoversCommand(command, response), false);
  for (const status of ['pending', 'unknown', 'failed']) assert.equal(acceptedHomeReceipt({ ...receipt({ tests: [row] }), status }, command.operationId), false);
});

test('create, delete and atomic note removal verify the requested result, not merely HTTP success', () => {
  const create = { operationId: 'operation-1', kind: 'write', collection: 'tests', record: row, expectedRevision: null };
  assert.equal(homeReceiptCoversCommand(create, receipt({ tests: [{ ...row, revision: 1 }] })), true);
  const remove = { operationId: 'operation-1', kind: 'remove', collection: 'tests', recordId: row.id, expectedRevision: 4 };
  assert.equal(homeReceiptCoversCommand(remove, receipt({ tests: [] })), true);
  assert.equal(homeReceiptCoversCommand(remove, receipt({ tests: [row] })), false);
  assert.equal(homeReceiptCoversCommand(remove, receipt({ gardens: [] })), false);
  const notes = { operationId: 'operation-1', kind: 'remove-notes', selection: [{ id: row.id, revision: 4 }] };
  assert.equal(homeReceiptCoversCommand(notes, receipt({ exploreNotes: [] })), true);
  assert.equal(homeReceiptCoversCommand(notes, receipt({ exploreNotes: [row] })), false);
});

test('privacy receipts must include an empty requested scope', () => {
  const clear = { operationId: 'operation-1', kind: 'clear-private', scope: 'journal', expectedFingerprint: 'exact-review' };
  assert.equal(homeReceiptCoversCommand(clear, receipt({ weekJournal: [] })), true);
  assert.equal(homeReceiptCoversCommand(clear, receipt({ tests: [] })), false);
  assert.equal(homeReceiptCoversCommand({ ...clear, scope: 'all' }, receipt({})), false);
  assert.equal(homeReceiptCoversCommand({ ...clear, scope: 'all' }, receipt({ tests: [row] })), false);
});

test('public resource links reject executable URLs and embedded credentials', () => {
  assert.equal(safePublicUrl('https://www.fda.gov/food'), true);
  for (const value of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', 'https://token@example.com', 'relative/path', null]) assert.equal(safePublicUrl(value), false);
});

test('source adapters reject incomplete scientific resource models', () => {
  assert.equal(validFishCatalogue({ waterbodies: [], audiences: [], rules: [], species: [] }), true);
  assert.equal(validFishCatalogue({ waterbodies: [], audiences: [], rules: [{}], species: [] }), false);
  const statewide = { id: 'advisory', title: 'Named species', kind: 'Statewide', waterbody: 'statewide', species: 'Bass', revision: 1, status: 'Current', date: '2026-10-13', extent: 'State A only', pollutant: 'Mercury', wording: 'Check source wording', condition: 'Defined audience', previous: '', url: 'https://agency.example.org/advisory' };
  const catalogue = { waterbodies: [{ id: 'lake-a', title: 'Lake A', extent: 'Defined lake', jurisdiction: 'State A' }], audiences: [], species: ['Bass'], rules: [statewide] };
  assert.equal(validFishCatalogue(catalogue), false, 'statewide is not authority to apply across every jurisdiction');
  assert.equal(validFishCatalogue({ ...catalogue, rules: [{ ...statewide, waterbodyIds: ['lake-a'] }] }), true);
  assert.equal(validFishCatalogue({ ...catalogue, rules: [{ ...statewide, waterbodyIds: ['foreign-lake'] }] }), false);
  assert.equal(validFoodNotices([]), true);
  assert.equal(validFoodNotices([{ title: 'FDA reference without scope or version' }]), false);
  assert.equal(validGrowerResources([]), true);
  assert.equal(validGrowerResources([{ title: 'Unverified directory' }]), false);
  assert.equal(validWaterStewardship({ counties: [], releases: [], notices: [] }), true);
  assert.equal(validWaterStewardship({ counties: [], releases: [{ id: 'x', none: NaN }], notices: [] }), false);
});

test('published food evidence keeps studies separate from household concentrations', () => {
  const bundle = evidenceForFood({ foodId: 'spinach' });
  assert.equal(validPublishedFoodEvidence(bundle), true);
  assert.equal(validPublishedFoodEvidence({ ...bundle, indicators: [{ contaminant: 'Lead', itemLevel: '18 ppb', label: 'Measured' }] }), false);
  assert.equal(validPublishedFoodEvidence({ ...bundle, studies: [{ ...bundle.studies[0], scope: 'your-item' }] }), false);
});

test('production store never seeds fixtures, increments revisions or runs private-erasure side effects', () => {
  const source = readFileSync(new URL('../components/homeguard/HomeWorkspaceState.tsx', import.meta.url), 'utf8');
  assert.match(source, /service \? \{\} : initialCollections\(\)/);
  assert.match(source, /if \(service\) \{ void loadCollection\(key\); return; \}/);
  assert.match(source, /state\.mode === 'production' \|\| state\.scenario === 'empty' \? \[\] : initial/);
  assert.match(source, /scopeKey \?\? 'isolated-preview'/);
  assert.match(source, /if \(checkOther\) \{ setMessage\('Use the account privacy review/);
  assert.match(source, /unknownRef\.current\.size/);
  assert.match(source, /service\.reconcile\(operationId, request\.signal, command\.kind/);
  assert.match(source, /Array\.isArray\(snapshot\.pendingOperations\)/, 'reopened sessions must discover unresolved writes before editing');
  assert.match(source, /loadVersions\.current\.get\(key\) !== version/);
});

test('summary and test contexts cannot fall back to another household in production', () => {
  const summary = readFileSync(new URL('../components/homeguard/SummaryWorkspace.tsx', import.meta.url), 'utf8');
  const tests = readFileSync(new URL('../components/homeguard/TestsWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(summary, /mode === 'production' \? liveData\.readings : previewFactorReadings/);
  assert.match(summary, /mode === 'production' \? home \? liveData\.home : liveData\.today/);
  assert.match(summary, /service\?\.context\?\.areaLabel \|\| 'Not supplied'/);
  assert.match(summary, /const \[openedAt, setOpenedAt\] = useState\(''\)/, 'first server and client renders must share a deterministic timestamp state');
  assert.match(summary, /queueMicrotask\(\(\) => \{ if \(active\) setOpenedAt\(new Date\(\)\.toISOString\(\)\)/);
  assert.match(summary, /mode === 'preview' && props\.view === 'preview' && !generated && !openedAt/, 'a direct summary entry must wait for its timestamp before creating any export');
  assert.doesNotMatch(summary, /useState\(\(\) => new Date\(\)\.toISOString\(\)\)/);
  assert.match(tests, /if \(workspace\.mode === 'production'\) return \[\.\.\.\(workspace\.service\?\.context\?\.homes \?\? \[\]\)/);
});
