import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { safeStageReturn } = await loadFrontend('stage-routing');
const { productRoute, productDestinationHref, legacyProductPath } = await loadFrontend('product-routes');
const { deliveredStagePath, routeOwner } = await loadFrontend('navigation');

test('clean product routes retain existing owners without mounting unknown paths', () => {
  for (const [path, legacy, owner] of [
    ['/app', '/plan', 'plan'], ['/app/plan', '/plan', 'plan'],
    ['/app/today', '/today', 'today'], ['/app/homeguard', '/home', 'home'],
    ['/app/explore', '/act', 'act'], ['/app/settings', '/settings', null],
    ['/app/journal', '/plan', 'plan'], ['/app/homeguard/tests', '/home', 'home'],
    ['/app/explore/activities', '/act', 'act'], ['/app/plan/reminders', '/plan', 'plan'],
  ]) {
    assert.equal(legacyProductPath(path), legacy);
    assert.equal(deliveredStagePath(path), true);
    assert.equal(routeOwner(path), owner);
    assert.equal(safeStageReturn(`${path}?address=private&token=secret`), path);
  }
  for (const path of ['/app/nope', '/app/homeguard/nope', '/app/explore/activities/private']) {
    assert.equal(productRoute(path), null);
    assert.equal(deliveredStagePath(path), false);
    assert.equal(safeStageReturn(path), '/plan');
  }
});
test('feature destinations retain semantic URL state and safe link composition', () => {
  assert.deepEqual(productRoute('/app/homeguard/tests/?homeView=list'), { legacy:'/home', destination:'tests' });
  assert.equal(productDestinationHref('home','tests'), '/app/homeguard/tests?view=main');
  assert.equal(productDestinationHref('act','projects'), '/app/explore/projects?view=main');
  assert.equal(productDestinationHref('plan','journal'), '/app/journal?view=main');
  assert.deepEqual(productRoute('/app/plan/reminders'), { legacy:'/plan', destination:'reminders' });
  assert.equal(productDestinationHref('plan','reminders'), '/app/plan/reminders?view=main');
});

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
