import { test, expect } from '@playwright/test';

test('air Patterns are fixed monitor density with controllable illustrative motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/foundation/preview/map/?layer=air&motion=full&appearance=light');
  const atlas = page.getByTestId('map-canvas');
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
  await expect(page.getByRole('button', { name: 'Legend', exact: true })).toContainText('Monitor location density');
  await page.getByRole('button', { name: 'Pause texture' }).click();
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
  await page.getByRole('button', { name: 'Resume texture' }).click();
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
});

test('reduced motion keeps weather-style contours static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/foundation/preview/map/?layer=air&motion=full');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-contour-motion', 'paused');
});

test('live motion and contrast preference changes stop and recover the texture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await page.goto('/foundation/preview/map/?layer=air&motion=full');
  const atlas = page.getByTestId('map-canvas');
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
});
