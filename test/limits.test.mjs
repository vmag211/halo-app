import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import './helpers/routeLoader.mjs'; // registers the module hooks, so lib files load as ES modules without the typeless-package warning

const limits = await import('../lib/limits.js');
const { BAND_KEYS } = await import('../lib/household.js');

test('lib/limits.js exports exactly the journal limits, nothing else', () => {
  assert.deepEqual(Object.keys(limits).sort(), [
    'JOURNAL_BANDS',
    'JOURNAL_MIN_DATE',
    'JOURNAL_NOTE_MAX',
    'JOURNAL_SEVERITIES',
    'JOURNAL_SYMPTOMS_MAX',
    'JOURNAL_SYMPTOM_MAX_CHARS',
  ]);
});

test('the limits have the values the brief fixes (Task 7 mirrors them in SQL)', () => {
  assert.equal(limits.JOURNAL_NOTE_MAX, 500);
  assert.equal(limits.JOURNAL_SYMPTOMS_MAX, 20);
  assert.equal(limits.JOURNAL_SYMPTOM_MAX_CHARS, 80);
  assert.equal(limits.JOURNAL_MIN_DATE, '2000-01-01');
  assert.deepEqual([...limits.JOURNAL_SEVERITIES], ['mild', 'moderate', 'bad']);
});

test('JOURNAL_BANDS is the seven household groups plus the household itself', () => {
  assert.deepEqual([...limits.JOURNAL_BANDS], [...BAND_KEYS, 'household']);
  assert.equal(limits.JOURNAL_BANDS.length, 8);
});

test('the lists cannot be changed by a caller', () => {
  for (const list of [limits.JOURNAL_SEVERITIES, limits.JOURNAL_BANDS]) {
    assert.equal(Object.isFrozen(list), true);
    assert.throws(() => list.push('x'), TypeError);
  }
});

test('the severities match the check constraint in migration 0003', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const file = readdirSync(dir).find((name) => name.startsWith('0003'));
  const sql = readFileSync(new URL(file, dir), 'utf8');
  const match = /severity\s+text\s+check\s*\(\s*severity\s+in\s*\(([^)]*)\)/i.exec(sql);
  assert.ok(match, 'migration 0003 declares the severity check');
  const declared = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(declared, [...limits.JOURNAL_SEVERITIES]);
});

test('lib/limits.js is pure (imports only the household group list) and has no em dash', () => {
  const source = readFileSync(new URL('../lib/limits.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '(.*)';?$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./household.js']);
  assert.equal(source.includes(String.fromCharCode(0x2014)), false);
});
