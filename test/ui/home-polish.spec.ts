import { test, expect, type Page } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const failures: string[] = []; errors.set(page, failures);
  page.on('pageerror', error => failures.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
      failures.push(`Unexpected request: ${url.pathname}`); return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
const route = (section: string, view: string, record = '') => `/foundation/preview/expanded/?tab=home&destination=${section}&homeView=${view}&record=${record}&motion=reduce&time=day`;

for (const appearance of ['dark', 'light']) test(`finishing details remain readable at 320px and 150% in ${appearance}`, async ({ page }, testInfo) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 320, height: 850 });
  for (const [section, view, id] of [
    ['food', 'fish-detail', 'demo-state-fish'], ['maintenance', 'observation-detail', 'sample-moisture'],
    ['food', 'usage-detail', 'demo-use-1'], ['food', 'grower-detail', 'soil'], ['summary', 'selection', ''],
  ]) {
    await page.goto(`${route(section, view, id)}&appearance=${appearance}&scale=150`);
    await expect(page.locator('[data-home-heading]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${view} fits`).toBe(true);
    await expect(page.locator('.hg-workspace')).not.toContainText('Review control:');
    for (const button of await page.locator('.hg-delete-button').all()) {
      await expect(button).toContainText('Delete');
      expect(await button.locator('svg').evaluate(el => el.getBoundingClientRect().width)).toBe(18);
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    for (const pair of await page.locator('.hg-facts > div').all()) {
      await expect.poll(() => pair.evaluate(element => {
        const term = element.querySelector('dt')!.getBoundingClientRect();
        const value = element.querySelector('dd')!.getBoundingClientRect();
        return value.top >= term.bottom;
      })).toBe(true);
    }
    if (view === 'fish-detail') {
      const toggle = page.getByRole('button', { name: 'View extent diagram' });
      const icon = toggle.locator('svg');
      expect((await icon.boundingBox())!.width).toBeLessThanOrEqual(24);
      expect((await toggle.boundingBox())!.width).toBeGreaterThan(160);
      await toggle.click();
      await expect(page.getByRole('button', { name: 'Hide extent diagram' })).toBeVisible();
      await expect(page.locator('.hg-extent figure')).toBeVisible();
    }
    await page.locator('.hg-content').screenshot({ path: testInfo.outputPath(`${view}-${appearance}.png`) });
  }
});

test('summary simulation is outside the app and reset restores its default', async ({ page }) => {
  await page.goto(route('summary', 'selection'));
  await expect(page.locator('.hg-workspace').getByLabel('Simulate summary section failure')).toHaveCount(0);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  const failure = page.getByLabel('Simulate summary section failure');
  await failure.selectOption('tests');
  await page.getByRole('button', { name: 'Reset Homeguard sample records' }).click();
  await expect(failure).toHaveValue('');
});

test('test result region can be scrolled using the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${route('tests', 'detail', 'test-water-september')}&scale=150`);
  const table = page.locator('.hg-table-wrap').first();
  await expect(table).toHaveAttribute('tabindex', '0');
  await expect(table).toHaveAttribute('role', 'region');
  await table.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect(await table.locator('th').first().evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(155);
});
