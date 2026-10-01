import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Preview attempted a live request');
    await route.continue();
  });
});

test('household is a dedicated route with working filters and visit-only checks', async ({ page }) => {
  await page.goto('/foundation/preview?appearance=dark&motion=reduce&time=day');
  await page.locator('.halo-ph-family-link').click();
  await expect(page).toHaveURL(/\/preview\/family/);
  await expect(page.getByRole('heading', { name: 'Your household', exact: true })).toBeVisible();
  await expect(page.locator('.halo-family-guidance-item')).toHaveCount(4);
  await page.getByRole('button', { name: 'Outdoors', exact: true }).click();
  await expect(page.locator('.halo-family-guidance-item')).toHaveCount(3);
  await page.getByRole('button', { name: 'At home', exact: true }).click();
  await expect(page.locator('.halo-family-guidance-item')).toHaveCount(1);
  await page.locator('.halo-family-guidance-item details').first().locator('summary').click();
  await expect(page.locator('.halo-family-guidance-item details[open]')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Look at the UV window before time outdoors.' }).check();
  await expect(page.locator('.halo-family-checklist [role="status"]')).toContainText('1 of 3');
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Look at the UV window before time outdoors.' })).not.toBeChecked();
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByTestId('factor-scorecard')).toHaveCount(4);
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'dark');
});

for (const appearance of ['light', 'dark']) test(`family ${appearance} supports small screens, enlarged text and no-data`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`/foundation/preview/family?appearance=${appearance}&time=day&motion=reduce`);
  await expect(page.locator('.halo-family')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByText('HALO design review', { exact: true }).click();
  await page.getByLabel('Text size', { exact: true }).selectOption('150');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.goto(`/foundation/preview/family?appearance=${appearance}&scenario=no-data&motion=reduce`);
  await expect(page.locator('.halo-family-window')).toHaveCount(0);
  await expect(page.locator('.halo-family-guidance-item')).toHaveCount(4);
  await expect(page.locator('.halo-family')).not.toContainText('AQI 37');
  await expect(page.locator('body')).not.toContainText('\u2014');
  expect(errors).toEqual([]);
  if (process.env.HALO_REFINEMENT_SCREENSHOT === '1') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/foundation/preview/family?appearance=${appearance}&time=day&motion=reduce`);
    await expect(page.locator('.halo-family-hero .halo-env')).toHaveAttribute('data-phase', 'day');
    await page.screenshot({ path: info.outputPath(`family-${appearance}.png`), fullPage: true, animations: 'disabled', caret: 'initial' });
  }
});

test('factor scenes are distinct, source education works, and active tab returns to overview', async ({ page }, info) => {
  const scenes: string[] = [];
  for (const factor of ['air', 'uv', 'pollen', 'mold', 'pfas']) {
    await page.goto(`/foundation/preview/factor/${factor}?appearance=dark&time=day&motion=reduce`);
    const scene = page.locator('.halo-ph-factor-hero .halo-env__photo');
    scenes.push(await scene.evaluate(n => getComputedStyle(n).backgroundImage));
    if (factor === 'pfas') {
      await expect(page.locator('.halo-ph-tips')).toContainText('exact model and PFAS-reduction claim');
      await expect(page.locator('.halo-ph-tips')).not.toContainText('majority of tested brands');
    }
    await page.locator('.halo-reading-guide summary').click();
    await expect(page.locator('.halo-reading-guide details[open] > a')).toBeVisible();
    await page.getByRole('navigation', { name: 'On this factor page' }).getByRole('link', { name: 'References', exact: true }).click();
    await expect(page).toHaveURL(/#reading-sources$/);
    if (process.env.HALO_REFINEMENT_SCREENSHOT === '1' && ['mold', 'air', 'pfas'].includes(factor)) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: info.outputPath(`${factor}-dark.png`), fullPage: true, animations: 'disabled', caret: 'initial' });
    }
  }
  expect(new Set(scenes).size).toBe(5);
  await page.getByRole('link', { name: 'Today', exact: true }).click();
  await expect(page.getByTestId('factor-scorecard')).toHaveCount(4);
  await expect(page.locator('.halo-f-assistant')).toHaveCSS('width', '44px');
});
