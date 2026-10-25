/**
 * A food study's "Source & updates" link names that study's own contaminant
 * and publication. The whole-milk lead study once read "FDA PFAS food
 * monitoring publications" because one caption was reused for every study.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadFrontend } from './frontend-test-loader.mjs';
import { foodNotices } from '../lib/publicEvidence.js';

const { foodSourceCaption, validFoodNotices } = await loadFrontend('production/home-resources');
const { foodEvidence: previewEvidence } = await loadFrontend('home-food-preview');

test('every served study is captioned with its own contaminant and publication, and still passes the client check', () => {
  const notices = foodNotices();
  assert.ok(notices?.length > 0);
  assert.equal(validFoodNotices(notices), true);
  for (const notice of notices) {
    const caption = foodSourceCaption(notice);
    assert.ok(caption.startsWith(`${notice.contaminant} results: `), `${notice.id}: ${caption}`);
    assert.ok(caption.endsWith(notice.sourceTitle), `${notice.id}: ${caption}`);
    if (notice.contaminant !== 'PFAS') assert.ok(!caption.includes('PFAS'), `${notice.id}: ${caption}`);
    assert.ok(!caption.includes('—'));
  }
  const milk = notices.find((notice) => notice.id === 'fda-tds-2018-2020-whole-milk-lead');
  assert.equal(foodSourceCaption(milk), 'Lead results: FDA Total Diet Study, FY2018-FY2020');
});

test('notices, older answers without the new fields, and the preview fixture get a caption that claims nothing extra', () => {
  assert.equal(foodSourceCaption({ kind: 'Notice' }), 'FDA enforcement source documentation');
  assert.equal(foodSourceCaption({ kind: 'Study' }), 'Official food monitoring publication');
  assert.equal(foodSourceCaption({ kind: 'Study', contaminant: 'Lead' }), 'Official Lead food monitoring publication');
  const demo = previewEvidence.find((item) => item.id === 'demo-study');
  assert.equal(foodSourceCaption(demo), 'Official PFAS food monitoring publication');
});

test('the evidence screen reads its caption from the record, not a fixed PFAS sentence', () => {
  const source = readFileSync(new URL('../components/homeguard/FoodEvidence.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('foodSourceCaption(evidence)'));
  assert.ok(!source.includes('FDA PFAS food monitoring publications'));
});
