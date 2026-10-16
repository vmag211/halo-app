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
  await expect(workspace).toContainText('Your home records could not load.');
  await expect(workspace).not.toContainText('Lower-level radon test');
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

test('missing production readings retain their missing state in score transparency', async ({ page }) => {
  const network = await mockProduction(page);
  await page.goto('/app/today');
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

test('Today and Homeguard use bounded desktop composition without changing mobile order', async ({ page }, info) => {
  const network = await mockProduction(page, {
    '/api/frontend/workspace': (route, url) => jsonRoute(route, { records: url.searchParams.get('collection') === 'tests' ? [current] : [], revision: 1, availability: 'ready', complete: true, pendingOperations: [] }),
  });
  for (const tab of ['today', 'homeguard']) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/app/${tab}`);
    const scene = page.locator('.halo-ph-overview-header > .halo-ph-landscape');
    const summary = page.locator('.halo-ph-overview-summary');
    await expect(scene).toBeVisible();
    await expect(summary).toBeVisible();
    const sceneBox = (await scene.boundingBox())!;
    const summaryBox = (await summary.boundingBox())!;
    expect(summaryBox.x).toBeGreaterThan(sceneBox.x + sceneBox.width);
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
    const mobileSummary = await summary.locator('.halo-ph-introduction').boundingBox();
    // The retained mobile introduction overlaps the decorative scene edge by 22px.
    expect(mobileSummary!.y).toBeGreaterThan(mobileScene.y + mobileScene.height - 50);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${tab}-mobile.png`) });
  }
  expect(network.blocked).toEqual([]);
});
