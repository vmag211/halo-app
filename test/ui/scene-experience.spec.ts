import { test, expect } from '@playwright/test';

test.use({ timezoneId: 'America/New_York' });
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Preview attempted a live request');
    await route.continue();
  });
});

test('live lighting crosses dawn in dark appearance without reloading', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-30T07:59:40-04:00') });
  await page.goto('/foundation/preview?tab=today&appearance=dark&time=live');
  const scene = page.locator('.halo-environment-scene .halo-env');
  await expect(scene).toHaveAttribute('data-phase', 'dawn');
  await page.clock.fastForward(31_000);
  await expect(scene).toHaveAttribute('data-phase', 'day');
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'dark');
});

test('day and night override stays independent of appearance and persists through routes', async ({ page }) => {
  await page.goto('/foundation/preview?tab=today&appearance=light&time=night');
  await expect(page.locator('.halo-environment-scene .halo-env')).toHaveAttribute('data-phase', 'night');
  await expect(page.locator('.halo-env__moon')).toHaveCSS('opacity', '1');
  await page.getByTestId('factor-scorecard').filter({ hasText: 'Mold' }).click();
  await expect(page).toHaveURL(/time=night/);
  await expect(page.locator('.halo-ph-factor-hero .halo-env')).toHaveAttribute('data-phase', 'night');
  await page.locator('.halo-f-review-tools > summary').click();
  await page.getByLabel('Scene lighting', { exact: true }).selectOption('day');
  await expect(page.locator('.halo-ph-factor-hero .halo-env')).toHaveAttribute('data-phase', 'day');
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'light');
});

test('full motion animates bounded scenery without random particles, and pause freezes it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/foundation/preview/factor/mold?motion=full&time=day');
  const scene = page.locator('.halo-ph-factor-hero .halo-env');
  const photo = scene.locator('.halo-env__photo');
  await expect(scene.locator('.halo-env__particles')).toHaveCount(0);
  await expect(scene).toHaveAttribute('data-moving', 'true');
  const first = await photo.evaluate(n => getComputedStyle(n).transform);
  await expect.poll(() => photo.evaluate(n => getComputedStyle(n).transform)).not.toBe(first);
  await page.getByRole('button', { name: 'Pause ambient animation' }).click();
  await expect(photo).toHaveCSS('animation-play-state', 'paused');
  const paused = await photo.evaluate(n => getComputedStyle(n).transform);
  await page.waitForTimeout(200);
  expect(await photo.evaluate(n => getComputedStyle(n).transform)).toBe(paused);
  await page.getByRole('button', { name: 'Play ambient animation' }).click();
  await expect(scene).toHaveAttribute('data-moving', 'true');
});

test('device reduction preserves final scores even in full mode; permitted motion draws charts', async ({ page }) => {
  await page.goto('/foundation/preview?tab=today&motion=system');
  await expect(page.locator('.halo-environment-score .halo-number')).toHaveText('74');
  await expect(page.locator('.halo-environment-scene .halo-env__photo')).toHaveCSS('animation-name', 'none');
  await page.locator('.halo-f-review-tools > summary').click();
  await page.getByLabel('Animation', { exact: true }).selectOption('full');
  await page.locator('.halo-f-review-tools > summary').click();
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-animate','false');
  await expect(page.locator('.halo-environment-score .halo-number')).toHaveText('74');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-animate','true');
  await page.getByTestId('factor-scorecard').first().click();
  const chart = page.locator('.halo-ph-chart-reveal');
  await page.getByRole('slider').scrollIntoViewIfNeeded();
  await expect(chart).toHaveCSS('animation-name', 'halo-chart-draw');
  await expect(chart).toHaveCSS('clip-path', /^inset\(0px(?: 0% 0px 0px)?\)$/);
  await expect(page.locator('.halo-ph-card-score')).toHaveCount(0);
});

test('staggered cards reveal their final scores and a factor-colored hover', async ({ page }) => {
  await page.goto('/foundation/preview?tab=today&motion=full');
  const card = page.getByTestId('factor-scorecard').first();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.halo-number')).toHaveText('88');
  const parent = card.locator('..');
  await expect(parent).toHaveAttribute('data-reveal', 'visible');
  const background = await card.evaluate(n => getComputedStyle(n).backgroundColor);
  await card.hover();
  await expect.poll(() => card.evaluate(n => getComputedStyle(n).backgroundColor)).not.toBe(background);
});
