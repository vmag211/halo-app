import { test, expect } from '@playwright/test';

const tests = '/foundation/preview/expanded/?tab=home&destination=tests&motion=reduce&time=day';

// Side-by-side entry cards left a phone about one word per line ("Plan a / test",
// "Track a / test / you / arrange"). Each card's copy needs a readable measure.
for (const width of [320, 375, 414, 820, 1440]) test(`test entry cards keep a readable text column at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height:900 });
  await page.goto(tests);
  const cards = page.locator('.hg-test-entry-tools .hg-link');
  await expect(cards).toHaveCount(2);
  for (const card of await cards.all()) {
    const copy = await card.locator('> span:not(.hg-work-art)').boundingBox();
    expect(copy!.width).toBeGreaterThanOrEqual(140);
    const art = await card.locator('[data-work-art]').boundingBox();
    expect(art!.width).toBeLessThanOrEqual(48);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

// The entry scroll keeps the workspace switcher in view; when it already is, a freshly loaded
// page must not jump by the height of the refresh bar once React takes over.
test('a workspace opened at the top does not jump after hydration', async ({ page }) => {
  await page.setViewportSize({ width:320, height:850 });
  await page.goto('/foundation/preview/expanded/?tab=home&destination=maintenance&homeView=observation-detail&record=sample-moisture&motion=reduce&time=day&scale=150');
  await page.waitForURL(/[?&]palette=/);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await expect(page.locator('.hg-workspace-nav')).toBeInViewport();
});
