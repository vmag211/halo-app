import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { foundationScenarios } from '../../lib/frontend/foundation-preview';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error(`Foundation preview attempted a live request: ${url.origin}${url.pathname}`);
    }
    await route.continue();
  });
});

for (const mode of ['light', 'dark'] as const) {
  for (const [scenario] of foundationScenarios) {
    test(`review ${mode} ${scenario}`, async ({ page }) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
      await page.goto(`/foundation/preview?scenario=${scenario}`);
      await expect(page.getByTestId('foundation-product')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      if (scenario.startsWith('sheet-')) await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('body')).not.toContainText('\u2014');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      expect(errors).toEqual([]);
      if (process.env.HALO_CAPTURE_FOUNDATION === '1') {
        const directory = resolve('docs/foundation/review/screenshots'); mkdirSync(directory, { recursive: true });
        await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
        await page.evaluate(() => { const tools = document.querySelector<HTMLElement>('.halo-f-review-tools'); if (tools) tools.hidden = true; });
        await page.screenshot({ path: resolve(directory, `${mode}-375-${scenario}.png`), animations: 'disabled' });
        await page.setViewportSize({ width: 320, height: 850 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
        await page.screenshot({ path: resolve(directory, `${mode}-320-${scenario}.png`), animations: 'disabled' });
      }
    });
  }
}

test('tabs, Back, settings return, and scroll memory', async ({ page }) => {
  await page.goto('/foundation/preview');
  await page.evaluate(() => window.scrollTo(0, 300));
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Homeguard', exact: true }).first()).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to previous page' }).click();
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('sheets trap focus, replace instead of stacking, Back closes, scroll and focus restore', async ({ page }) => {
  await page.goto('/foundation/preview');
  const bell = page.getByRole('button', { name: 'Alerts, 3 unread' });
  const before = await page.evaluate(() => window.history.length);
  await bell.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => window.history.length)).toBe(before + 1);
  await expect(page.locator('.halo-f-assistant')).toHaveCount(0);
  await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBeTruthy();
  await expect(page.locator('.halo-f-badge')).toHaveText('3');
  await page.getByRole('button', { name: 'Read sample alert' }).click();
  await expect(page.locator('.halo-f-badge')).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Alerts, 2 unread' })).toBeFocused();
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/foundation/preview?scenario=sheet-content');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page).toHaveURL(/sheet=map/);
  const length = await page.evaluate(() => window.history.length);
  await page.getByRole('button', { name: 'Replace with Learn' }).click();
  expect(await page.evaluate(() => window.history.length)).toBe(length);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.goBack(); await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('pasted Learn link closes without leaving preview, invalid topics are ignored', async ({ page }) => {
  await page.goto('/foundation/preview?learn=pfas');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('This topic has no reading context on the current page.')).toBeVisible();
  const before = await page.evaluate(() => window.history.length);
  await page.getByRole('button', { name: 'Close sheet' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => window.history.length)).toBe(before);
  await expect(page).toHaveURL(/\/foundation\/preview\/?(?:\?|$)/);
  expect(new URL(page.url()).searchParams.has('learn')).toBeFalsy();
  await page.goto('/foundation/preview?learn=invalid');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('backdrop and drag dismissal', async ({ page }) => {
  await page.goto('/foundation/preview?scenario=sheet-standard');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.mouse.click(8, 40);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open standard sheet' }).click();
  const box = await page.locator('.halo-f-sheet-grab').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 10); await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 95); await page.mouse.up();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('contribution links open factor routes and missing factors remain explicit', async ({ page }) => {
  await page.goto('/foundation/preview?scenario=partial');
  const before = await page.evaluate(() => window.history.length);
  await page.locator('.halo-ph-legend').getByRole('link', { name: /^Air,/ }).click();
  await expect(page).toHaveURL(/\/factor\/air/);
  expect(await page.evaluate(() => window.history.length)).toBe(before + 1);
  await page.goBack();
  await expect(page.getByTestId('factor-scorecard').filter({ hasText: 'Pollen' })).toContainText('No data');
});

test('delete and Undo are immediate, one toast lasts eight seconds', async ({ page }) => {
  await page.clock.install();
  await page.goto('/foundation/preview?scenario=swipe');
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await page.getByRole('button', { name: 'Delete entry' }).click();
  await expect(page.locator('.halo-f-swipe')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.halo-f-swipe')).toBeVisible();
  await page.getByRole('button', { name: 'Show another confirmation' }).click();
  await page.clock.fastForward(7999); await expect(page.locator('.halo-f-toast')).toBeVisible();
  await page.clock.fastForward(1); await expect(page.locator('.halo-f-toast')).toHaveCount(0);
});

test('validation on blur, enabled submit, clear valid errors, retained values, note limit', async ({ page }) => {
  await page.goto('/foundation/preview?scenario=form');
  const address = page.getByLabel('Address or ZIP code');
  await address.fill('123'); await expect(page.getByText('Enter an address or ZIP code.', { exact: true })).toHaveCount(0);
  await address.blur(); await expect(page.getByText('Enter an address or ZIP code.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await address.fill('28025'); await expect(page.getByText('Enter an address or ZIP code.', { exact: true })).toHaveCount(0);
  await page.getByLabel('Journal note').fill('a'.repeat(401)); await expect(page.getByText('401/500')).toBeVisible();
  await page.goto('/foundation/preview?scenario=form-error');
  await page.clock.install(); await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 1000)));
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await page.clock.fastForward(650);
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await expect(page.getByLabel('Address or ZIP code')).toHaveValue('28025');
  await expect(page.getByText("We couldn't save your changes. Your answers are still here. Try again.")).toBeVisible();
});

test('segment arrows, optional groups, optimistic failure and one accordion', async ({ page }) => {
  await page.goto('/foundation/preview?scenario=controls-failure');
  const radio = page.getByRole('radio', { name: 'Log', exact: true });
  await radio.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Trends' })).toHaveAttribute('aria-checked', 'true');
  const child = page.getByRole('button', { name: 'Children', exact: true });
  await child.click(); await expect(child).toHaveAttribute('aria-pressed', 'true');
  await expect(child).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText("We couldn't save that change. Your previous choice has been restored.")).toBeVisible();
  await page.getByRole('button', { name: /^Accessibility/ }).click();
  await expect(page.locator('#household-options')).toHaveCount(0);
});

for (const width of [320, 430, 900]) {
  for (const scenario of ['shell', 'form', 'long-text', 'controls', 'sheet-tall', 'identity'] as const) {
    test(`enlarged layout ${width} ${scenario}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await page.goto(`/foundation/preview?scenario=${scenario}`);
      if (scenario !== 'sheet-tall') { await page.getByText('HALO design review', { exact: true }).click(); await page.getByLabel('Text size', { exact: true }).selectOption('150'); }
      await page.evaluate(() => document.fonts.ready);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      if (process.env.HALO_CAPTURE_FOUNDATION === '1') {
        await page.addStyleTag({ content: 'nextjs-portal { display:none !important; }' });
        await page.evaluate(() => { const tools = document.querySelector<HTMLElement>('.halo-f-review-tools'); if (tools) tools.hidden = true; });
        await page.screenshot({ path: resolve(`docs/foundation/review/screenshots/large-${width}-${scenario}.png`), animations: 'disabled' });
      }
    });
  }
}
