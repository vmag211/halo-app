import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { safeStageReturn } = await loadFrontend('stage-routing');
test('onboarding preserves only supported local destinations and safe fragments', () => {
  assert.equal(safeStageReturn('/factors/air#reading-sources'), '/factors/air#reading-sources');
  assert.equal(safeStageReturn('/household/senior/'), '/household/senior');
  assert.equal(safeStageReturn('/home?address=private#household'), '/home#household');
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/today\n', '/settings?next=//evil.example', '/api/account', '/map', '/factors/nope', null]) {
    assert.equal(safeStageReturn(path), path === '/settings?next=//evil.example' ? '/settings' : '/today');
  }
});
