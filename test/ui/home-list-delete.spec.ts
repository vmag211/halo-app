import { test, expect, type Page } from '@playwright/test';

const url = (section: string, view = 'list') => `/foundation/preview/expanded/?tab=home&destination=${section}&homeView=${view}&appearance=dark&scale=100&motion=reduce&time=day`;
const faults = new WeakMap<Page, string[]>();
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

for (const [section, view, title] of [
  ['tests', 'list', ''],
  ['maintenance', 'list', 'Kitchen filter upkeep'],
  ['maintenance', 'list', 'Window condensation'],
  ['food', 'gardens', ''],
  ['food', 'usage', 'August water bill'],
]) test(`${section}/${view}/${title || 'first record'} deletes only after confirmation`, async ({ page }) => {
  await page.goto(url(section, view));
  const selected = title ? page.locator('.hg-deletable-record').filter({ hasText: title }).first() : page.locator('.hg-deletable-record').first();
  const button = selected.locator('.hg-delete-compact');
  const name = await button.getAttribute('aria-label');
  const count = await page.locator('.hg-deletable-record').count();
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Are you sure?' });
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(page.locator('.hg-deletable-record')).toHaveCount(count);
  await expect(page.getByRole('button', { name: name!, exact: true })).toBeFocused();
  await button.click();
  await dialog.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.hg-deletable-record')).toHaveCount(count - 1);
  await expect(page.getByRole('button', { name: name!, exact: true })).toHaveCount(0);
  await expect(page.locator('.hg-workspace :focus')).toHaveCount(1);
  await expect(page.locator('button button')).toHaveCount(0);
  if (title === 'Kitchen filter upkeep') await expect(page.getByRole('button', { name: /^Window condensation/ })).toBeVisible();
});

for (const failure of ['save-error', 'conflict']) test(`list deletion preserves records on ${failure}`, async ({ page }) => {
  await page.goto(url('tests'));
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Homeguard workspace state').selectOption(failure);
  const count = await page.locator('.hg-deletable-record').count();
  await page.locator('.hg-delete-compact').first().click();
  const dialog = page.getByRole('dialog', { name: 'Are you sure?' });
  await dialog.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(dialog.getByRole('alert')).toContainText(failure === 'save-error' ? 'sample save failed' : 'Revision conflict');
  await dialog.getByRole('button', { name: 'No, keep it' }).click();
  await expect(page.locator('.hg-deletable-record')).toHaveCount(count);
  await page.getByLabel('Homeguard workspace state').selectOption('offline');
  await expect(page.locator('.hg-delete-compact').first()).toBeDisabled();
});

test('kitchen food can be removed from its shelf without losing catalogue access', async ({ page }) => {
  await page.goto(url('food', 'pantry-add') + '&record=salmon');
  await page.getByRole('button', { name: /Add to/ }).click();
  await expect(page.getByRole('heading', { name: 'Salmon', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to my kitchen', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Salmon', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, delete' }).click();
  await expect(page.locator('.hg-kitchen-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Find a food', exact: true }).click();
  await page.getByLabel('Find a food').fill('salmon');
  await expect(page.getByRole('button', { name: 'Salmon', exact: true })).toBeVisible();
});

for (const appearance of ['light', 'dark']) test(`trash targets fit a narrow screen with large text in ${appearance}`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(url('maintenance').replace('scale=100', 'scale=150').replace('appearance=dark', `appearance=${appearance}`));
  for (const button of await page.locator('.hg-delete-compact').all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    const card = await button.locator('..').locator('.hg-link').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(card!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(card!.x + card!.width);
    expect(bounds!.y).toBeGreaterThanOrEqual(card!.y);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(card!.y + card!.height);
    expect((await button.locator('svg').boundingBox())!.width).toBe(14);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results-home-delete/maintenance-delete-${appearance}.png`, fullPage: true });
});
