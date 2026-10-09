import { test, expect, type Page } from '@playwright/test';

const faults = new WeakMap<Page, string[]>();
const url = (section: string, view = 'list', record = '', appearance = 'dark') => `/foundation/preview/expanded/?tab=home&destination=${section}&homeView=${view}&record=${record}&appearance=${appearance}&motion=reduce&time=day`;
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(target.hostname) || target.pathname.startsWith('/api/')) {
      errors.push(`Unexpected live request: ${target.pathname}`); return route.abort();
    }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function scenario(page: Page, value: string) {
  const control = page.getByLabel('Homeguard workspace state');
  if (!await control.isVisible()) await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await control.selectOption(value);
}

test('deleting a routine is deliberate and leaves the linked observation and saved Plan action intact', async ({ page }) => {
  await page.goto(url('maintenance', 'observation-edit', 'sample-moisture'));
  await page.getByLabel('Linked routine (optional)').selectOption('sample-filter');
  await page.getByRole('button', { name: 'Save observation', exact: true }).click();
  await page.getByRole('button', { name: 'Open linked routine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen filter upkeep', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save to Plan', exact: true }).click();
  const action = page.getByRole('dialog', { name: 'Save a practical step' });
  await expect(action.getByLabel('Action title')).toHaveValue('Follow up on Kitchen filter upkeep');
  await action.getByRole('button', { name: 'Save sample action' }).click();
  await expect(page.getByRole('button', { name: 'Open saved action' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete this routine?' });
  await expect(deletion).toContainText('Separate moisture observations, tests and saved Plan actions are kept.');
  await deletion.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen filter upkeep', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await deletion.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No routines yet' })).toBeVisible();
  await page.getByRole('button', { name: /^Window condensation/ }).click();
  await expect(page.getByText('The linked routine was removed. This observation is still available.')).toBeVisible();
  await page.getByRole('button', { name: 'Edit observation', exact: true }).click();
  await expect(page.getByLabel('Linked routine (optional)')).toHaveValue('sample-filter');
  await expect(page.getByLabel('Linked routine (optional)').locator('option:checked')).toHaveText('Previously linked routine (removed)');
  // Preserve the origin action even when its record is gone, rather than silently completing or deleting it.
  await page.getByRole('link', { name: 'Plan', exact: true }).click();
  await expect(page.getByText('Follow up on Kitchen filter upkeep', { exact: true }).first()).toBeVisible();
});

for (const failure of ['save-error', 'conflict']) test(`${failure} does not delete a routine or dismiss the confirmation`, async ({ page }) => {
  await page.goto(url('maintenance', 'detail', 'sample-filter'));
  await scenario(page, failure);
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete this routine?' });
  await deletion.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(deletion.getByRole('alert')).toContainText(failure === 'save-error' ? 'sample save failed' : 'Revision conflict');
  await expect(deletion).toBeVisible();
  await deletion.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await scenario(page, 'ready');
  await expect(page.getByRole('heading', { name: 'Kitchen filter upkeep', exact: true })).toBeVisible();
  await expect(page.locator('.hg-history')).toContainText('Completed');
});

test('offline disables destructive record controls without losing saved information', async ({ page }) => {
  await page.goto(url('maintenance', 'detail', 'sample-filter'));
  await scenario(page, 'offline');
  await expect(page.getByRole('button', { name: 'Delete routine', exact: true })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Kitchen filter upkeep', exact: true })).toBeVisible();
  await expect(page.locator('.hg-history')).toContainText('Completed');
});

test('moisture deletion can be cancelled and failed deletion retains the record', async ({ page }) => {
  await page.goto(url('maintenance', 'observation-detail', 'sample-moisture'));
  await expect(page.locator('.hg-details')).toContainText('Condensation');
  await scenario(page, 'save-error');
  await page.getByRole('button', { name: 'Delete observation', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Delete this observation?' });
  await deletion.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(deletion.getByRole('alert')).toContainText('sample save failed');
  await deletion.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await scenario(page, 'ready');
  await page.getByRole('button', { name: 'Delete observation', exact: true }).click();
  await deletion.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No observations recorded' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Kitchen filter upkeep/ })).toBeVisible();
});

test('test searches ignore accidental spaces and have a visible reset while results remain', async ({ page }) => {
  await page.goto(url('tests'));
  await page.getByRole('searchbox', { name: 'Search records' }).fill('  september  ');
  await expect(page.getByRole('button', { name: /^Kitchen tap, September/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Kitchen tap, June/ })).not.toBeVisible();
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search records' })).toHaveValue('');
  await expect(page.getByRole('button', { name: /^Kitchen tap, June/ })).toBeVisible();
});

test('result and comparison tables can be scrolled with the keyboard on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(url('tests', 'detail', 'test-water-september'));
  const results = page.getByRole('region', { name: /Original user-entered result transcription/ });
  await results.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => results.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole('button', { name: /^Compare records/ }).click();
  await page.getByLabel('Compare with another record').selectOption('test-water-june');
  const comparison = page.getByRole('region', { name: /Original values, same unit and sample basis/ });
  await comparison.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => comparison.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  await expect(comparison).toContainText('1.8');
});

for (const appearance of ['light', 'dark']) test(`record tools fit narrow large-text layouts in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${url('maintenance', 'observation-detail', 'sample-moisture', appearance)}&scale=150`);
  const details = await page.locator('.hg-observation-record .hg-details').boundingBox();
  const tools = page.getByRole('group', { name: 'Observation tools' });
  const row = await tools.boundingBox();
  expect(row!.y - details!.y - details!.height).toBeGreaterThanOrEqual(16);
  for (const name of ['Edit observation', 'Delete observation']) {
    const button = tools.getByRole('button', { name, exact: true });
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await expect(button.locator('svg')).toHaveCount(1);
  }
  await page.screenshot({ path: testInfo.outputPath(`observation-tools-${appearance}.png`), fullPage: true });
  await page.goto(`${url('maintenance', 'detail', 'sample-filter', appearance)}&scale=150`);
  await expect(page.getByRole('button', { name: 'Delete routine', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record completion', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.goto(`${url('tests', 'detail', 'test-water-september', appearance)}&scale=150`);
  const testDelete = page.getByRole('button', { name: 'Delete record', exact: true });
  await expect(testDelete.locator('svg')).toHaveCount(1);
  expect((await testDelete.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
