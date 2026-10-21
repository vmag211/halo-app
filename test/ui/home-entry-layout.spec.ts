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
