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
  await page.goto('/foundation/preview?appearance=dark&time=live');
  const scene = page.locator('.halo-ph-landscape .halo-env');
  await expect(scene).toHaveAttribute('data-phase', 'dawn');
  await page.clock.fastForward(31_000);
  await expect(scene).toHaveAttribute('data-phase', 'day');
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'dark');
});

test('day and night override stays independent of appearance and persists through routes', async ({ page }) => {
  await page.goto('/foundation/preview?appearance=light&time=night');
  await expect(page.locator('.halo-ph-landscape .halo-env')).toHaveAttribute('data-phase', 'night');
  await expect(page.locator('.halo-env__moon')).toHaveCSS('opacity', '1');
  await page.getByTestId('factor-scorecard').filter({ hasText: 'Mold' }).click();
  await expect(page).toHaveURL(/time=night/);
  await expect(page.locator('.halo-ph-factor-hero .halo-env')).toHaveAttribute('data-phase', 'night');
  await page.getByText('HALO design review', { exact: true }).click();
  await page.getByLabel('Scene lighting', { exact: true }).selectOption('day');
  await expect(page.locator('.halo-ph-factor-hero .halo-env')).toHaveAttribute('data-phase', 'day');
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'light');
});

test('full motion overrides device reduction, camera and spores move, pause freezes them', async ({ page }) => {
  await page.goto('/foundation/preview/factor/mold?motion=full&time=day');
  const scene = page.locator('.halo-ph-factor-hero .halo-env');
  const photo = scene.locator('.halo-env__photo');
  const spore = scene.locator('.halo-env__particles i').nth(5);
  await expect(scene).toHaveAttribute('data-moving', 'true');
  const first = await photo.evaluate(n => getComputedStyle(n).transform);
  const firstSpore = await spore.evaluate(n => getComputedStyle(n).translate);
  await expect.poll(() => photo.evaluate(n => getComputedStyle(n).transform)).not.toBe(first);
  await expect.poll(() => spore.evaluate(n => getComputedStyle(n).translate)).not.toBe(firstSpore);
  await page.getByRole('button', { name: 'Pause ambient animation' }).click();
  await expect(photo).toHaveCSS('animation-play-state', 'paused');
  const paused = await photo.evaluate(n => getComputedStyle(n).transform);
  await page.waitForTimeout(200);
  expect(await photo.evaluate(n => getComputedStyle(n).transform)).toBe(paused);
  await page.getByRole('button', { name: 'Play ambient animation' }).click();
  await expect(scene).toHaveAttribute('data-moving', 'true');
});

test('device reduction shows final values and removes animation; explicit play draws ring and charts', async ({ page }) => {
  await page.goto('/foundation/preview?motion=system');
  await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('74');
  await expect(page.locator('.halo-ph-landscape .halo-env__photo')).toHaveCSS('animation-name', 'none');
  await page.getByText('HALO design review', { exact: true }).click();
  await page.getByLabel('Animation', { exact: true }).selectOption('full');
  await page.getByText('HALO design review', { exact: true }).click();
  await expect(page.locator('.halo-ph-ring-reveal')).toHaveCSS('animation-name', 'halo-ring-draw');
  await expect(page.locator('.halo-ph-ring-center strong')).toHaveText('74');
  await page.getByTestId('factor-scorecard').first().click();
  const chart = page.locator('.halo-ph-chart-reveal');
  await page.getByRole('slider').scrollIntoViewIfNeeded();
  await expect(chart).toHaveCSS('animation-name', 'halo-chart-draw');
  await expect(chart).toHaveCSS('clip-path', /^inset\(0px(?: 0% 0px 0px)?\)$/);
  await expect(page.locator('.halo-ph-card-score')).toHaveCount(0);
});

test('staggered cards reveal their final scores and a factor-colored hover', async ({ page }) => {
  await page.goto('/foundation/preview?motion=full');
  const card = page.getByTestId('factor-scorecard').first();
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator('.halo-number')).toHaveText('88');
  const parent = card.locator('..');
  await expect(parent).toHaveAttribute('data-reveal', 'visible');
  const background = await card.evaluate(n => getComputedStyle(n).backgroundColor);
  await card.hover();
  await expect.poll(() => card.evaluate(n => getComputedStyle(n).backgroundColor)).not.toBe(background);
});
