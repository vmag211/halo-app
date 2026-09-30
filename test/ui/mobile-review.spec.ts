import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('live onboarding renders the approved mobile design', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page.locator('.halo-mobile-shell .halo-app')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'to HALO', exact: true })).toBeAttached();
  await expect(page.locator('.halo-welcome-subtitle span').last()).toHaveText('HALO');
  await expect(page.locator('.halo-band')).toHaveCSS('border-bottom-left-radius', '36px');
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[320, 568], [375, 812], [430, 932], [1280, 900]]) {
    test(`mobile proposal flow ${colorScheme} ${width}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.goto('/onboarding/preview?design=mobile');
      await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeEnabled();
      await page.addStyleTag({ content: '.halo-preview-toolbar, nextjs-portal { display:none !important; }' });
      const product = page.locator('.halo-app');
      const capture = async (name: string) => {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await product.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.evaluate(() => document.fonts.ready);
        await product.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' });
      };
      await capture('01-welcome');
      const cta = await page.getByRole('button', { name: 'Get started', exact: true }).boundingBox();
      expect(cta!.y + cta!.height).toBeLessThanOrEqual(height);
      await page.getByRole('button', { name: 'Get started', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Where do you live?' })).toBeVisible();
      await capture('02-address');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.locator('#halo-address')).toBeFocused();
      await page.locator('#halo-address').fill('28025');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Who lives here?' })).toBeVisible();
      await page.getByRole('button', { name: 'Adult', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Adult', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await capture('03-household');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'A little about your home.' })).toBeVisible();
      await capture('04-home');
      await page.locator('#halo-water').selectOption('utility');
      await page.getByRole('button', { name: 'See my results', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Results reveal' })).toBeAttached();
      await expect(page.getByRole('button', { name: 'See my results', exact: true })).toBeEnabled();
      await capture('05-results');
      expect(await page.locator('body').innerText()).not.toContain('\u2014');
      await page.getByRole('button', { name: 'See my results', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Onboarding flow complete' })).toBeVisible();
    });
  }
}

test('switch designs without discarding answers; enlarged text stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/onboarding/preview?design=mobile');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.locator('#halo-address').fill('28025');
  await page.getByRole('combobox', { name: 'Design', exact: true }).selectOption('approved');
  await expect(page.locator('#halo-address')).toHaveValue('28025');
  await page.getByRole('combobox', { name: 'Design', exact: true }).selectOption('mobile');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Who lives here?' })).toBeVisible();
  await page.addStyleTag({ content: '.halo-app p, .halo-app label, .halo-app button { font-size:200%; line-height:1.5; }' });
  expect(await page.locator('.halo-app').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await page.locator('.halo-chip').all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});
