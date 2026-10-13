import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { safeStageReturn } = await loadFrontend('stage-routing');

test('owned map reentry retains only its access mode, never private inputs',()=>{
 assert.equal(safeStageReturn('/map?access=owned&lat=35&record=private'),'/map?access=owned');
 assert.equal(safeStageReturn('/map?access=public&token=private'),'/map');
});
test('onboarding preserves only supported local destinations and safe fragments', () => {
  assert.equal(safeStageReturn('/factors/air#reading-sources'), '/factors/air#reading-sources');
  assert.equal(safeStageReturn('/household/senior/'), '/household/senior');
  assert.equal(safeStageReturn('/home?address=private#household'), '/home#household');
  for(const path of ['/plan','/act','/map','/learn'])assert.equal(safeStageReturn(path),path);
  for (const path of ['https://evil.example', '//evil.example', '/\\evil.example', '/today\n', '/settings?next=//evil.example', '/api/account', '/factors/nope', null]) {
    assert.equal(safeStageReturn(path), path === '/settings?next=//evil.example' ? '/settings' : '/plan');
  }
});
