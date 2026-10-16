import { expect, test } from '@playwright/test';
import { emptyTest, type TestRecord } from '../../lib/frontend/home-test-preview';
import { homeId, mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

const current: TestRecord = { ...emptyTest('current-radon'), title: 'Current home radon test', purpose: 'Keep the original test record', contextId: homeId, medium: 'air', kind: 'radon', status: 'awaiting', collectionStart: '2026-10-01', collectionEnd: '2026-10-03' };

test('home overview retries real collections and promotes the current home test', async ({ page }) => {
  let ready = false;
  let testReads = 0;
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => {
      const tests = url.searchParams.get('collection') === 'tests';
      if (tests) testReads++;
      if (tests && !ready) return jsonRoute(route, { error: 'unavailable' }, 503);
      return jsonRoute(route, { records: tests ? [{ ...current, id: 'previous-radon', title: 'Previous home test', contextId: 'previous-home' }, current] : [], revision: 1, availability: 'ready', complete: true, pendingOperations: [] });
    },
  });
  await page.goto('/app/homeguard');
  const workspace = page.locator('#home-workspace');
  await expect(workspace).toContainText('Some home records could not load.');
  await expect(workspace).not.toContainText('Lower-level radon test');
  await expect(workspace.locator('.how-overview-row.how-care')).toContainText('0 routines');
  await expect(workspace.locator('.how-overview-row.how-food')).toContainText('0 foods');
  const before = testReads;
  ready = true;
  await workspace.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(workspace.getByRole('link', { name: 'Continue test', exact: true })).toBeVisible();
  await expect(workspace.locator('.how-priority')).toContainText(current.title);
  await expect(workspace.locator('.how-priority')).not.toContainText('Previous home test');
  await expect(workspace.locator('.how-shortcuts')).not.toHaveAttribute('open', '');
  expect(testReads).toBeGreaterThan(before);
  await workspace.getByRole('link', { name: 'Continue test', exact: true }).click();
  await expect(page.getByRole('heading', { name: current.title, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter results', exact: true })).toBeVisible();
  expect(network.requests.filter(item => item.method !== 'GET')).toEqual([]);
  expect(network.blocked).toEqual([]);
});

for (const unavailableCollection of ['pantryItems', 'assets']) test(`a ${unavailableCollection} failure keeps loaded home test and other work available`, async ({ page }) => {
  let ready = false;
  let release: () => void = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const reads: string[] = [];
  const network = await mockProduction(page, {
    '/api/frontend/workspace': async (route, url) => {
      const collection = url.searchParams.get('collection') ?? '';
      reads.push(collection);
      if (collection === unavailableCollection && !ready) {
        await pending;
        await jsonRoute(route, { error:'unavailable' }, 503);
        return;
      }
      await jsonRoute(route, { records:collection === 'tests' ? [current] : [], revision:1, availability:'ready', complete:true, pendingOperations:[] });
    },
  });
  await page.goto('/app/homeguard');
  const workspace = page.locator('#home-workspace');
  try {
    await expect(workspace.getByRole('link', { name:'Continue test', exact:true })).toBeVisible();
    await expect(workspace).toContainText('Loading more home records.');
  } finally { release(); }
  await expect(workspace).toContainText('Some home records could not load.');
  await expect(workspace.locator('.how-priority')).toContainText(current.title);
  await expect(workspace.locator('.how-overview-row.how-tests')).toContainText('1 active');
  await expect(workspace.locator(unavailableCollection === 'assets' ? '.how-overview-row.how-food' : '.how-overview-row.how-care')).toContainText(unavailableCollection === 'assets' ? '0 foods' : '0 routines');
  const requiredCollections = ['tests', 'assets', 'observations', 'gardens', 'pantryItems'];
  const before = Object.fromEntries(requiredCollections.map(key => [key, reads.filter(value => value === key).length]));
  ready = true;
  await workspace.getByRole('button', { name:'Try again', exact:true }).click();
  await expect(workspace.locator('.how-notice')).toHaveCount(0);
  for (const key of requiredCollections) expect(reads.filter(value => value === key)).toHaveLength(before[key] + Number(key === unavailableCollection));
  await workspace.getByRole('link', { name:'Continue test', exact:true }).click();
  await expect(page.getByRole('heading', { name:current.title, exact:true })).toBeVisible();
  expect(network.requests.filter(item => item.method !== 'GET')).toEqual([]);
  expect(network.blocked).toEqual([]);
});

test('missing production readings retain their missing state in score transparency', async ({ page }) => {
  const network = await mockProduction(page);
  await page.goto('/app/today');
  await expect(page.locator('.halo-environment-area')).toHaveText('Home area: Cabarrus, NC');
  const disclosure = page.locator('.halo-score-transparency');
  await disclosure.locator('> summary').click();
  await expect(disclosure).toContainText('0 of 4 readings');
  await expect(disclosure.locator('.halo-score-source-row')).toHaveCount(4);
  for (const row of await disclosure.locator('.halo-score-source-row').all()) await expect(row).toContainText('Reading unavailable');
  await disclosure.getByText('Calculation details', { exact: true }).click();
  await expect(disclosure).toContainText('175.8');
  await expect(disclosure).toContainText('Completing a task does not change the score.');
  expect(network.blocked).toEqual([]);
});

for (const tab of ['today', 'homeguard']) test(`${tab} uses bounded desktop composition and a purposeful mobile order`, async ({ page }, info) => {
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => jsonRoute(route, { records: url.searchParams.get('collection') === 'tests' ? [current] : [], revision: 1, availability: 'ready', complete: true, pendingOperations: [] }),
  });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/app/${tab}`);
    const scene = page.locator('.halo-environment-scene');
    const summary = page.locator('.halo-environment-summary');
    await expect(scene).toBeVisible();
    await expect(summary).toBeVisible();
    const sceneBox = (await scene.boundingBox())!;
    const summaryBox = (await summary.boundingBox())!;
    const primary = tab === 'homeguard' ? page.locator('#home-workspace') : page.locator('.halo-environment-evidence');
    const primaryBox = (await primary.boundingBox())!;
    expect(Math.abs(primaryBox.x - summaryBox.x)).toBeGreaterThan(200);
    expect(sceneBox.width).toBeLessThan(550);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${tab}-desktop.png`) });
    if (tab === 'homeguard') {
      await page.locator('#home-workspace').scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath('homeguard-desktop-workspace.png') });
    }
    await page.setViewportSize({ width: 375, height: 850 });
    await page.goto(`/app/${tab}`);
    await expect(scene).toBeVisible();
    const mobileScene = (await scene.boundingBox())!;
    expect(mobileScene.height).toBeLessThan(160);
    if (tab === 'homeguard') {
      const action = (await page.getByRole('link', { name:'Continue test', exact:true }).boundingBox())!;
      expect(action.y + action.height).toBeLessThan(670);
      expect((await primary.boundingBox())!.y).toBeLessThan((await summary.boundingBox())!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${tab}-mobile.png`) });
  expect(network.blocked).toEqual([]);
});
