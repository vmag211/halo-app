import { test, expect } from '@playwright/test';
import { factorKeys } from '../../lib/frontend/factor-preview';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Preview attempted a live request: ${url.pathname}`);
    await route.continue();
  });
});

test('Today has four factors, no PFAS contribution, and Homeguard owns PFAS', async ({ page }) => {
  await page.goto('/foundation/preview');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByTestId('factor-scorecard')).toHaveCount(4);
  await expect(page.locator('.halo-ph-overview')).not.toContainText('PFAS');
  const arcs = page.locator('.halo-ph-ring-segment');
  await expect(arcs).toHaveCount(4);
  const shares = await arcs.evaluateAll(nodes => nodes.map(n => Number(n.getAttribute('stroke-dasharray')!.split(' ')[0])));
  [12, 28, 14, 8].forEach((expected, index) => expect(shares[index]).toBeCloseTo(expected / 62 * 100, 10));
  expect(shares.reduce((total, n) => total + n, 0)).toBeCloseTo(100, 10);
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.locator('.halo-ph-ring-segment[data-factor="pfas"]')).toHaveCount(1);
  const before = await page.evaluate(() => window.history.length);
  await page.getByTestId('factor-scorecard').filter({ hasText: 'PFAS' }).click();
  await expect(page).toHaveURL(/\/factor\/pfas/);
  await expect(page.getByRole('heading', { name: 'Each compound, in context' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why yours reads this way' })).toBeVisible();
  expect(await page.evaluate(() => window.history.length)).toBe(before + 1);
  await page.goBack();
  await expect(page.getByTestId('factor-scorecard')).toHaveCount(3);
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Homeguard', exact: true })).toBeVisible();
  await expect(page.getByTestId('factor-scorecard')).toHaveCount(3);
});

for (const appearance of ['light', 'dark']) {
  for (const factor of factorKeys) {
    test(`${appearance} ${factor} detail is usable at 320px and enlarged text`, async ({ page }, info) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width: 320, height: 850 });
      await page.goto(`/foundation/preview/factor/${factor}?appearance=${appearance}`);
      await expect(page.locator(`.halo-env--${factor}:not(.halo-env--page)`)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Small steps that help' })).toBeVisible();
      await expect(page.locator('body')).not.toContainText('\u2014');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      await page.getByText('HALO design review', { exact: true }).click();
      await page.getByLabel('Text size', { exact: true }).selectOption('150');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
      expect(errors).toEqual([]);
      if (process.env.HALO_REVIEW_SCREENSHOT === '1' && ['air', 'uv', 'pfas'].includes(factor)) {
        await page.getByLabel('Text size', { exact: true }).selectOption('100');
        await page.getByText('HALO design review', { exact: true }).click();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: info.outputPath(`${factor}-${appearance}.png`), fullPage: true, animations: 'disabled' });
      }
    });
  }
}

test('no data, zero, partial and zero-risk have distinct semantics', async ({ page }) => {
  await page.goto('/foundation/preview?scenario=no-data');
  await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('No data');
  await expect(page.locator('.halo-ph-ring-segment')).toHaveCount(0);
  await page.goto('/foundation/preview?scenario=score-zero');
  await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('0');
  await page.goto('/foundation/preview?scenario=contribution-zero');
  await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('100');
  await expect(page.locator('.halo-ph-ring-segment')).toHaveCount(0);
  await page.goto('/foundation/preview?scenario=partial');
  await expect(page.locator('.halo-ph-ring-partial')).toHaveCount(1);
  await expect(page.getByTestId('factor-scorecard').filter({ hasText: 'Pollen' })).toContainText('No data');
  await page.goto('/foundation/preview/factor/pfas?scenario=no-data');
  await expect(page.getByRole('heading', { name: 'Why yours reads this way' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Each compound, in context' })).toHaveCount(0);
});

test('theme persists through factor links, motion pauses, and reduced motion removes animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/foundation/preview?appearance=dark&motion=system');
  await page.getByRole('button', { name: 'Pause ambient animation' }).click();
  expect(await page.locator('.halo-env__cloud--near').evaluate(n => getComputedStyle(n).animationPlayState)).toBe('paused');
  await page.getByTestId('factor-scorecard').first().click();
  await expect(page.locator('.halo-ph-detail[data-factor="air"]')).toBeVisible();
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'dark');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.halo-env__birds')).toHaveCSS('animation-name', 'none');
  await page.getByRole('link', { name: 'Back to Today', exact: true }).click();
  await expect(page.getByTestId('factor-scorecard')).toHaveCount(4);
});

test('chart inspection, missing history, offline Learn and unscored lead', async ({ page }) => {
  await page.goto('/foundation/preview/factor/air');
  const slider = page.getByRole('slider'); await slider.focus(); await slider.press('Home'); await slider.press('ArrowRight'); await slider.press('ArrowRight'); await slider.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Sun, No reading');
  await page.getByText('View readings as a table').click();
  await expect(page.getByRole('table')).toContainText('No data');
  await page.goto('/foundation/preview/factor/pfas?scenario=offline');
  await expect(page.getByRole('heading', { name: 'What it is' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Why yours reads this way' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Lead in plumbing', exact: true }).click();
  await expect(page.locator('.halo-ph-detail-score')).toContainText('Not scored');
  await expect(page.locator('.halo-ph-trend')).toHaveCount(0);
});

test('overview visual review', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/foundation/preview');
  await expect(page.locator('.halo-ph-scene-top')).not.toContainText('Local time');
  if (process.env.HALO_REVIEW_SCREENSHOT === '1') {
    await page.screenshot({ path: info.outputPath('overview-light.png'), fullPage: true, animations: 'disabled' });
    await page.screenshot({ path: info.outputPath('overview-viewport.png'), animations: 'disabled' });
  }
  await page.goto('/foundation/preview?appearance=dark');
  if (process.env.HALO_REVIEW_SCREENSHOT === '1') await page.screenshot({ path: info.outputPath('overview-dark.png'), fullPage: true, animations: 'disabled' });
});
