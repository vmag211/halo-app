import { test, expect, type Page } from '@playwright/test';

const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.message}`));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) {
      errors.push(`Unexpected live request: ${url.pathname}`); return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));
const url = (section: string, view = 'list', extra = '') => `/foundation/preview/expanded/?review=tools&tab=home&destination=${section}&homeView=${view}&appearance=dark&motion=reduce&time=day${extra}`;
const cases = [
  ['tests', 'list', ''], ['tests', 'new', ''], ['tests', 'detail', 'test-water-september'],
  ['tests', 'results', 'test-water-september'], ['tests', 'compare', 'test-water-september'],
  ['maintenance', 'list', ''], ['maintenance', 'create', ''], ['maintenance', 'observation', ''],
  ['maintenance', 'detail', 'sample-filter'], ['summary', 'selection', ''], ['summary', 'preview', ''],
  ['food', 'list', ''], ['food', 'fish', ''], ['food', 'fish-detail', 'demo-local-fish'],
  ['food', 'fish-notes', ''], ['food', 'fish-note-new', ''], ['food', 'gardens', ''],
  ['food', 'garden-detail', 'demo-garden'], ['food', 'garden-edit', 'demo-garden'],
  ['food', 'evidence', ''], ['food', 'evidence-detail', 'demo-notice'],
  ['food', 'growers', ''], ['food', 'water', ''], ['food', 'usage', ''], ['food', 'usage-new', ''],
  ['food', 'pantry', ''], ['food', 'pantry-detail', 'seafood'], ['food', 'pantry-saved', ''],
] as const;

for (const appearance of ['dark', 'light']) test(`Homeguard screens fit 320px and enlarged text in ${appearance}`, async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 320, height: 850 });
  for (const [section, view, id] of cases) {
    await page.goto(url(section, view, `&record=${id}&scale=150`).replace('appearance=dark', `appearance=${appearance}`));
    await expect(page.locator('[data-home-heading]')).toBeVisible();
    const navigation = await page.getByRole('combobox', { name: 'Home workspace', exact: true }).boundingBox();
    expect(navigation?.height ?? 1000, 'Section navigation stays compact, not vertical letters').toBeLessThan(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section}:${view} overflows`).toBe(true);
    await expect(page.locator('.hg-workspace')).not.toContainText('\u2014');
    expect(await page.locator('.hg-content').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
    if (view === 'list' || section === 'summary' && view === 'preview') { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: testInfo.outputPath(`${section}-${view}-${appearance}.png`), fullPage: true }); }
  }
});

test('unavailable deep links do not substitute another private record', async ({ page }) => {
  for (const [section, view] of [['tests', 'detail'], ['maintenance', 'detail'], ['food', 'garden-detail'], ['food', 'usage-edit']]) {
    await page.goto(url(section, view, '&record=removed-record'));
    await expect(page.locator('.hg-empty')).toContainText(/unavailable/i);
  }
});

test('global review states distinguish loading, failure, empty and offline', async ({ page }) => {
  await page.goto(url('tests'));
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  const control = page.getByLabel('Homeguard workspace state');
  await control.selectOption('loading');
  await expect(page.getByRole('heading', { name: 'Opening your home workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await control.selectOption('error');
  await expect(page.getByRole('heading', { name: 'This section could not load' })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await control.selectOption('empty');
  await expect(page.getByRole('heading', { name: 'Start your home record' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset Homeguard sample records' }).click();
  await expect(page.getByRole('button', { name: /^Kitchen tap, September/ })).toBeVisible();
  await control.selectOption('offline');
  await page.getByRole('button', { name: /^Plan a test/ }).click();
  await expect(page.getByRole('button', { name: 'Save test plan' })).toBeDisabled();
  await expect(page.locator('.hg-form')).toContainText('changes are not queued.');
});

test('desktop Homeguard uses the existing centered shell and keyboard workspace selector', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(url('food'));
  const workspace = page.getByRole('combobox', { name: 'Home workspace', exact: true });
  await expect(workspace).toHaveValue('food');
  await workspace.focus();
  await page.keyboard.press('ArrowUp');
  await expect(page.locator('[data-home-heading]')).toHaveText('Maintenance & moisture');
  await expect(page.locator('[data-home-heading]')).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('homeguard-desktop.png'), fullPage: true });
});

for (const appearance of ['light', 'dark']) test(`standard phone review screenshots in ${appearance}`, async ({ page }, testInfo) => {
  for (const section of ['tests', 'maintenance', 'food', 'summary']) {
    await page.goto(url(section).replace('appearance=dark', `appearance=${appearance}`));
    await expect(page.locator('[data-home-heading]')).toBeVisible();
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`${section}-375-${appearance}.png`), fullPage: true });
  }
});
