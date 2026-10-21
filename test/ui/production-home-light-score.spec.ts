import { expect, test } from '@playwright/test';
import { mockProduction, settingsSnapshot } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

// The score line always sits on the dark landscape. In the light theme the outlined
// No data pill took the light theme's dark grey and almost disappeared into the photo.
for (const appearance of ['light', 'dark'] as const) test(`the hero No data pill stays readable on the scene in ${appearance}`, async ({ page }) => {
  const network = await mockProduction(page, { '/api/settings': route => jsonRoute(route, { ...settingsSnapshot, display:{ ...settingsSnapshot.display, appearance } }) });
  await page.goto('/app/homeguard');
  const pill = page.locator('.halo-environment-scoreline .halo-severity[data-severity="no_data"]');
  await expect(pill).toBeVisible();
  const [r, g, b] = (await pill.evaluate(element => getComputedStyle(element).color)).match(/\d+/g)!.map(Number);
  // Relative luminance of the text; the scene behind it is a dark overlay.
  const channel = (value: number) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  expect(0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)).toBeGreaterThan(0.6);
  expect(network.blocked).toEqual([]);
});
