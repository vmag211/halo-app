import { test, expect } from '@playwright/test';

const home = '/foundation/preview/expanded/?review=tools&tab=home&motion=reduce&time=day';
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
    await expect(workspace).toContainText('1 active');
    await expect(workspace).toContainText('3 reports');
    await expect(workspace.locator('.how-shortcuts')).not.toHaveAttribute('open', '');
    await expect(workspace.locator('.how-overview-row')).toHaveCount(4);
    const primary = workspace.getByRole('link', { name: 'Continue test', exact: true });
    const restingForeground = await primary.evaluate(element => getComputedStyle(element).color);
    await primary.hover();
    await expect(primary).toHaveCSS('color', restingForeground);
    await primary.focus();
    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(primary).toBeFocused();
    await expect(primary).toHaveCSS('color', restingForeground);
    if (width === 320) {
      const navigation = page.getByRole('navigation', { name: 'Main navigation', exact: true });
      for (const label of ['My Week', 'Today', 'Homeguard', 'Explore']) {
        const link = navigation.getByRole('link', { name: label, exact: true });
        const target = (await link.boundingBox())!;
        const text = (await link.locator('span').boundingBox())!;
        expect(text.x).toBeGreaterThanOrEqual(target.x);
        expect(text.x + text.width).toBeLessThanOrEqual(target.x + target.width);
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
      }
    }
    await workspace.locator('.how-shortcuts > summary').click();
    await workspace.locator('.how-stage-details > summary').click();
    await expect(page.getByRole('list', { name: /Recorded milestones/ })).toContainText('Not recorded');
    await expect(page.getByRole('list', { name: /Recorded milestones/ }).locator('[data-recorded="true"]')).toHaveCount(1);
    await workspace.locator('.how-stage-details > summary').click();
    await expect(workspace.locator('.how-stage-details')).not.toHaveAttribute('open','');
    await workspace.locator('.how-shortcuts > summary').click();
    const house = await page.locator('.halo-home-household').boundingBox();
    const panel = await workspace.boundingBox();
    expect(panel!.y + panel!.height).toBeLessThan(house!.y);
    await expect(page.getByRole('heading', { name: 'The people who make it home', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(workspace).not.toContainText('\u2014');
    if (width===375) {
      // Bound the complete redesigned workbench to one compact surface.
      // The exact continuation remains within the compact workbench.
      expect((await workspace.boundingBox())!.height).toBeLessThan(600);
      await expect(workspace.getByRole('link',{name:'Open test records',exact:true})).toContainText('Tests');
      await expect(workspace.getByRole('link',{name:'Open Food and Garden',exact:true})).toContainText('Food and Garden');
    }
    // The requested scenic score leads, followed directly by the existing workbench.
    await page.evaluate(() => window.scrollTo(0, 0));
    const firstAction = (await primary.boundingBox())!;
    expect(firstAction.y).toBeGreaterThan(60);
    expect(firstAction.y + firstAction.height).toBeLessThan((await workspace.boundingBox())!.y + (await workspace.boundingBox())!.height);
    const localContext = (await page.locator('.halo-environment-summary').boundingBox())!;
    expect((await workspace.boundingBox())!.y).toBeGreaterThanOrEqual(localContext.y + localContext.height);
    await page.screenshot({ path: info.outputPath(`workspace-top-${appearance}-${width}.png`) });
    await workspace.screenshot({ path: info.outputPath(`workspace-${appearance}-${width}.png`) });
    await workspace.locator('.how-add-menu > summary').click();
    await expect(workspace.getByRole('link', { name: 'Plan a test', exact:true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
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
    ['Open test records', 'tests', '', ''],
    ['Open home care', 'maintenance', '', ''],
    ['Kitchen filter upkeep', 'maintenance', 'detail', 'sample-filter'],
    ['Window condensation', 'maintenance', 'observation-detail', 'sample-moisture'],
    ['Add routine', 'maintenance', 'create', ''],
    ['Record moisture', 'maintenance', 'observation', ''],
    ['Your kitchen', 'food', 'pantry', ''],
    ['Your gardens', 'food', 'gardens', ''],
    ['Fish and waterways', 'food', 'fish', ''],
    ['Water stewardship', 'food', 'water', ''],
    ['Open Food and Garden', 'food', '', ''],
    ['Continue with Back garden', 'food', 'garden-detail', 'demo-garden'],
    ['Create summary', 'summary', 'selection', ''],
  ]) {
    if (['Plan a test', 'Add a report', 'Add routine', 'Record moisture'].includes(name)) await workspace.locator('.how-add-menu > summary').click();
    if (['Continue test', 'Kitchen filter upkeep', 'Window condensation', 'Your kitchen', 'Your gardens', 'Fish and waterways', 'Water stewardship', 'Continue with Back garden'].includes(name)) await workspace.locator('.how-shortcuts > summary').click();
    await workspace.getByRole('link', { name: new RegExp(`^${name}`) }).click();
    await expect(page.locator('.hg-workspace')).toHaveAttribute('data-home-section', destination);
    const query = new URL(page.url()).searchParams;
    if (view) expect(query.get('homeView')).toBe(view);
    if (record) expect(query.get('record')).toBe(record);
    await page.getByRole('link', { name: 'Back to Homeguard', exact: true }).click();
    await expect(workspace).toBeVisible();
  }
});

test('overview groups home care without duplicating continuation or hiding entrances', async ({ page }) => {
  await page.goto(home);
  const workspace = page.locator('#home-workspace');
  await workspace.locator('.how-shortcuts > summary').click();
  const care = workspace.getByRole('region', { name: 'Records and home care', exact: true });
  await expect(care.getByRole('region', { name: 'Maintenance and moisture', exact: true })).toBeVisible();
  await expect(workspace.getByRole('link', { name: 'Continue test', exact: true })).toHaveCount(1);
  await expect(workspace.locator('.how-priority.how-continue')).toHaveCount(1);
  await workspace.locator('.how-stage-details > summary').click();
  await expect(workspace.getByRole('list', { name: /Recorded milestones/ })).toHaveCount(1);
  await expect(care).toContainText('Scheduled Oct 1');
  await expect(care).toContainText('Observed Sep 30');
  await expect(care.locator('time[datetime="2026-10-01"]')).toHaveAttribute('aria-label','Oct 1, 2026');
  await expect(care.locator('time[datetime="2026-09-30"]')).toHaveAttribute('aria-label','Sep 30, 2026');
  await expect(workspace.locator('.how-add-menu')).not.toHaveAttribute('open', '');
  await workspace.locator('.how-add-menu > summary').click();
  for (const name of ['Plan a test', 'Add a report', 'Add routine', 'Record moisture', 'Create summary']) {
    const entrance = workspace.getByRole('link', { name, exact: true });
    await expect(entrance).toBeVisible();
    expect((await entrance.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});

test('record creation updates the overview and review failures suppress counts', async ({ page }) => {
  await page.goto(home);
  await page.locator('#home-workspace .how-add-menu > summary').click();
  await page.locator('#home-workspace').getByRole('link', { name: 'Plan a test' }).click();
  await page.getByLabel('Test label (required)').fill('Overview test');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Check overview continuity');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await expect(page.getByRole('heading', { name: 'Overview test', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Homeguard', exact: true }).click();
  const workspace = page.locator('#home-workspace');
  await expect(workspace).toContainText('2 active');
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  const control = page.getByLabel('Homeguard workspace state');
  await control.selectOption('error');
  await expect(workspace).toContainText('Your home records could not load.');
  await expect(workspace).not.toContainText('2 active');
  await workspace.getByRole('button', { name: 'Try again' }).click();
  await expect(workspace).toContainText('2 active');
  await control.selectOption('empty');
  await expect(workspace).toContainText('0 active');
  await workspace.locator('.how-shortcuts > summary').click();
  await expect(workspace.getByRole('link', { name: 'Continue test' })).toHaveCount(0);
  await expect(workspace).toContainText('Add food');
  await page.getByRole('button', { name: 'Reset Homeguard sample records' }).click();
  await control.selectOption('offline');
  await expect(workspace).toContainText('Offline');
  await expect(workspace).toContainText('1 active');
});
