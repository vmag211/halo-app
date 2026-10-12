import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});
async function examples(page: Page) {
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByRole('button', { name: 'Load connected activity examples', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Connected activity examples loaded' })).toBeVisible();
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
}

for (const appearance of ['light', 'dark']) test(`fieldbook dashboard remains compact and useful in ${appearance}`, async ({ page }, info) => {
  for (const [width, scale] of [[375, 100], [320, 150], [1920, 100]]) {
    await page.setViewportSize({ width, height: 950 });
    await page.goto(`${root}&appearance=${appearance}&scale=${scale}`);
    await examples(page);
    await expect(page.locator('.mw-fieldbook')).toBeVisible();
    await expect(page.locator('.mw-agenda .ex-photo-solar')).toBeVisible();
    await expect(page.locator('.mw-time-track')).toContainText('9:00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const shell = (await page.getByTestId('foundation-product').boundingBox())!;
    const agenda = (await page.locator('.mw-agenda').boundingBox())!;
    const rail = (await page.locator('.mw-planning-rail').boundingBox())!;
    expect(shell.width).toBeLessThanOrEqual(Math.min(430, width));
    expect(Math.abs(shell.x - (width - shell.width) / 2)).toBeLessThan(1);
    expect(rail.x).toBeCloseTo(agenda.x, 0);
    expect(rail.y).toBeGreaterThanOrEqual(agenda.y + agenda.height);
    for (const button of await page.locator('.mw-agenda .mw-task-actions button').all()) {
      const bounds = (await button.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBeGreaterThanOrEqual(44);
    }
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.halo-f-app')!.getBoundingClientRect().top + window.scrollY));
    await page.screenshot({ path: info.outputPath(`week-polish-${appearance}-${width}.png`) });
    await page.evaluate(() => window.scrollTo(0, document.querySelector('.mw-in-progress')!.getBoundingClientRect().top + window.scrollY - 90));
    await page.screenshot({ path: info.outputPath(`week-work-${appearance}-${width}.png`) });
    await page.getByRole('button', { name: 'Month', exact: true }).click();
    await expect(page.locator('.mw-days button')).toHaveCount(42);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
});

test('compact task title opens its complete activity detail without another edit button', async ({ page }, info) => {
  await page.goto(`${root}&appearance=dark`); await examples(page);
  const task = page.locator('.mw-agenda .mw-task').filter({ hasText: 'Draw a testable design' });
  await expect(task.locator('.mw-task-actions button')).toHaveCount(1);
  await task.locator('.mw-task-open').click();
  const sheet = page.locator('#week-task-detail');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.mw-activity-photo')).toBeVisible();
  await sheet.getByText('How to do this step', { exact: true }).click();
  await expect(sheet).toContainText('Sketch a box with a dark absorbing surface');
  await page.screenshot({ path: info.outputPath('week-polish-project-detail.png') });
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(task.locator('.mw-task-open')).toBeFocused();
});

test('high contrast and reduced motion retain readable calendar selection', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 950 });
  await page.goto(`${root}&appearance=dark&contrast=true&scale=150`);
  await expect(page.locator('.mw-branch')).not.toBeVisible();
  expect(await page.locator('.mw-calendar').evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await expect(page.locator('.mw-days .selected')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Next period', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
