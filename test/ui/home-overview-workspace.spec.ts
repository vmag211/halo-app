import { test, expect } from '@playwright/test';

const home = '/foundation/preview/expanded/?tab=home&motion=reduce&time=day';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

for (const appearance of ['light', 'dark']) test(`home workspace fits narrow screens in ${appearance}`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const [width, scale] of [[375, 100], [320, 150]]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`${home}&appearance=${appearance}&scale=${scale}`);
    await expect(page.getByRole('heading', { name: 'Your home workspace' })).toBeVisible();
    const workspace = page.locator('#home-workspace');
    await expect(workspace).toContainText('1 active test');
    await expect(workspace).toContainText('3 reports');
    await expect(page.getByRole('list', { name: /Recorded milestones/ })).toContainText('Not recorded');
    await expect(page.getByRole('list', { name: /Recorded milestones/ }).locator('[data-recorded="true"]')).toHaveCount(1);
    const house = await page.locator('.halo-home-household').boundingBox();
    const panel = await workspace.boundingBox();
    expect(panel!.y).toBeGreaterThan(house!.y + house!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(workspace).not.toContainText('\u2014');
    await page.getByRole('link', { name: 'Open your home workspace' }).click();
    await expect(page).toHaveURL(/#home-workspace$/);
    await expect(workspace).toBeFocused();
    expect((await workspace.boundingBox())!.y).toBeGreaterThan(60);
    expect((await workspace.boundingBox())!.y).toBeLessThan(110);
    await page.screenshot({ path: info.outputPath(`workspace-top-${appearance}-${width}.png`) });
    await workspace.screenshot({ path: info.outputPath(`workspace-${appearance}-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('overview opens the exact records and all four feature areas', async ({ page }) => {
  await page.goto(home);
  const workspace = page.locator('#home-workspace');
  for (const [name, destination, view, record] of [
    ['Continue test', 'tests', 'detail', 'test-radon'],
    ['Plan a test', 'tests', 'new', ''],
    ['Add a report', 'tests', 'report', ''],
    ['View records', 'tests', '', ''],
    ['Kitchen filter upkeep', 'maintenance', 'detail', 'sample-filter'],
    ['Window condensation', 'maintenance', 'observation-detail', 'sample-moisture'],
    ['Add routine', 'maintenance', 'create', ''],
    ['Record moisture', 'maintenance', 'observation', ''],
    ['Your kitchen', 'food', 'pantry', ''],
    ['Your gardens', 'food', 'gardens', ''],
    ['Fish and waterways', 'food', 'fish', ''],
    ['Water stewardship', 'food', 'water', ''],
    ['Continue with Back garden', 'food', 'garden-detail', 'demo-garden'],
    ['Create summary', 'summary', 'selection', ''],
  ]) {
    await workspace.getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator('.hg-workspace')).toHaveAttribute('data-home-section', destination);
    const query = new URL(page.url()).searchParams;
    if (view) expect(query.get('homeView')).toBe(view);
    if (record) expect(query.get('record')).toBe(record);
    await page.getByRole('link', { name: 'Back to Homeguard', exact: true }).click();
    await expect(workspace).toBeVisible();
  }
});

test('record creation updates the overview and review failures suppress counts', async ({ page }) => {
  await page.goto(home);
  await page.locator('#home-workspace').getByRole('link', { name: 'Plan a test' }).click();
  await page.getByLabel('Test label (required)').fill('Overview test');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Check overview continuity');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await expect(page.getByRole('heading', { name: 'Overview test', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Homeguard', exact: true }).click();
  const workspace = page.locator('#home-workspace');
  await expect(workspace).toContainText('2 active tests');
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  const control = page.getByLabel('Homeguard workspace state');
  await control.selectOption('error');
  await expect(workspace).toContainText('Your home records could not load.');
  await expect(workspace).not.toContainText('2 active tests');
  await workspace.getByRole('button', { name: 'Retry sample records' }).click();
  await expect(workspace).toContainText('2 active tests');
  await control.selectOption('empty');
  await expect(workspace).toContainText('0 active tests');
  await expect(workspace.getByRole('link', { name: 'Continue test' })).toHaveCount(0);
  await expect(workspace).toContainText('Add your first food');
  await page.getByRole('button', { name: 'Reset Homeguard sample records' }).click();
  await control.selectOption('offline');
  await expect(workspace).toContainText('Offline review');
  await expect(workspace).toContainText('1 active test');
});
