import { test, expect } from '@playwright/test';

for (const appearance of ['light', 'dark']) test(`rising half-sun ${appearance} keeps the forecast readable`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/foundation/preview/family/?appearance=${appearance}&motion=reduce&time=day`);
  const window = page.locator('.halo-family-window');
  await window.scrollIntoViewIfNeeded();
  await expect(window.locator('.halo-rising-sun')).toBeVisible();
  await expect(window).toHaveCSS('border-top-width', '0px');
  await expect(window).toContainText('11am to 3pm');
  await expect(window.locator('.halo-rising-sun-disc')).toHaveCSS('animation-name', 'none');
  await window.screenshot({ path: info.outputPath(`half-sun-${appearance}.png`) });
  await page.goto(`/foundation/preview/factor/uv/?appearance=${appearance}&motion=reduce&scale=150`);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('.halo-ph-window .halo-rising-sun')).toBeVisible();
  await expect(page.locator('.halo-ph-window')).toContainText('11am to 3pm');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.goto(`/foundation/preview/family/?scenario=no-data&appearance=${appearance}&motion=reduce`);
  await expect(page.locator('.halo-rising-sun')).toHaveCount(0);
});

test('sun rises with full motion, rays pause, and reduction is static', async ({ page }) => {
  await page.goto('/foundation/preview/family/?appearance=dark&motion=full&time=night');
  await page.locator('.halo-family-window').scrollIntoViewIfNeeded();
  const sun = page.locator('.halo-rising-sun');
  await expect(sun.locator('.halo-rising-sun-disc')).toHaveCSS('animation-name', 'halo-sunrise');
  await expect(sun.locator('.halo-rising-sun-rays')).toHaveCSS('animation-name', 'halo-sun-ray-light');
  await page.getByRole('button', { name: 'Pause ambient animation' }).click();
  await expect(sun.locator('.halo-rising-sun-rays')).toHaveCSS('animation-play-state', 'paused');
  await page.getByText('HALO design review', { exact: true }).click();
  await page.getByLabel('Animation', { exact: true }).selectOption('reduce');
  await expect(sun.locator('.halo-rising-sun-rays')).toHaveCSS('animation-name', 'none');
});
