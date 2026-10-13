import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

for (const appearance of ['light', 'dark']) test(`Homeguard scorecards and compact workspace precede the household in ${appearance}`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const [width, scale] of [[375, 100], [320, 150]]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto(`/foundation/preview/expanded/?tab=home&appearance=${appearance}&scale=${scale}&motion=reduce&time=day`);
    const cards = page.locator('.halo-ph-factor-grid');
    await expect(cards.getByRole('link')).toHaveCount(3);
    await expect(cards).toContainText('PFAS in water');
    await expect(cards).toContainText('Radon');
    await expect(cards).toContainText('Lead in plumbing');
    const hero = await page.locator('.halo-ph-landscape').boundingBox();
    const grid = await cards.boundingBox();
    const workspace = await page.locator('#home-workspace').boundingBox();
    const house = await page.locator('.halo-home-household').boundingBox();
    expect(grid!.y).toBeGreaterThan(hero!.y + hero!.height);
    expect(grid!.y + grid!.height).toBeLessThanOrEqual(workspace!.y);
    expect(workspace!.y + workspace!.height).toBeLessThanOrEqual(house!.y);
    await expect(page.locator('.halo-ph-household')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`homeguard-${appearance}-${width}.png`), fullPage: true });
    await cards.getByRole('link').first().click();
    await expect(page.locator('.halo-ph-detail')).toHaveAttribute('data-factor', 'pfas');
  }
  expect(errors).toEqual([]);
});

test('general household guidance has no save-step controls or leftover save-only section', async ({ page }) => {
  const paths = ['/family', ...['toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory'].map(member => `/household/${member}`)];
  for (const path of paths) {
    await page.goto(`/foundation/preview${path}/?edition=expanded&appearance=dark&motion=reduce&time=day`);
    await expect(page.locator('.halo-family, .halo-home-member')).toBeVisible();
    await expect(page.getByRole('navigation', {name:'Main navigation'}).getByRole('link', {name:path==='/family'?'Today':'Homeguard',exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.getByRole('button', { name: 'Save this step', exact: true })).toHaveCount(0);
    await expect(page.getByText('Keep a useful household step', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open My Week' })).toBeVisible();
  }
});
