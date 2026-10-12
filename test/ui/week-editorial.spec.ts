import { test, expect } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=plan&motion=system&appearance=dark';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('journal scene does not disturb a private draft or category filters', async ({ page }) => {
  await page.goto(`${root}&destination=journal`);
  await expect(page.locator('.mw-editorial-intro img')).toHaveJSProperty('naturalWidth', 1536);
  await page.getByLabel('Private note (optional)').fill('Keep this private draft');
  await page.getByRole('button', { name: 'Season', exact: true }).click();
  await expect(page.locator('.mw-editorial-intro .halo-editorial-scene')).toHaveAttribute('data-editorial-scene', 'care-garden');
  await page.getByRole('button', { name: 'Patterns', exact: true }).click();
  await expect(page.locator('.mw-pattern-grid button')).toHaveCount(84);
  await page.getByRole('button', { name: 'Journal', exact: true }).click();
  await expect(page.getByLabel('Private note (optional)')).toHaveValue('Keep this private draft');
});

test('outdoor periods retain explicit choice and do not imply forecast availability', async ({ page }) => {
  await page.goto(`${root}&destination=outdoors`);
  await expect(page.locator('.mw-editorial-intro img')).toHaveJSProperty('naturalWidth', 1536);
  for (const period of ['Morning', 'Afternoon', 'Evening']) {
    const choice = page.getByRole('button', { name: `${period} Forecast unavailable` });
    await choice.click();
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.mw-outdoor-periods [aria-pressed=true]')).toHaveCount(1);
  }
  await page.getByLabel('What would you like to do?').fill('Water the garden');
  await page.getByRole('button', { name: 'Save outdoor plan', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('No forecast watch');
});

for (const appearance of ['dark', 'light']) test(`${appearance} editorial headers stay legible and contained at large text`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 900 });
  for (const destination of ['journal', 'outdoors']) {
    await page.goto(`${root.replace('appearance=dark', `appearance=${appearance}`)}&destination=${destination}&scale=150`);
    const hero = page.locator('.mw-editorial-intro');
    await expect(hero.getByRole('heading')).toBeVisible();
    await expect(hero.locator('.halo-editorial-scene')).toHaveAttribute('data-moving', 'false');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`${destination}-${appearance}.png`), fullPage: true });
  }
});
