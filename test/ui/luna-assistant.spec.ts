import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Luna preview attempted a live request');
    await route.continue();
  });
});

for (const appearance of ['light', 'dark']) test(`Luna ${appearance} welcome, sample conversation, options and keyboard close`, async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/foundation/preview/?appearance=${appearance}&motion=reduce&time=day`);
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Luna', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Your HALO assistant', { exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(panel.locator('.halo-luna-prompts > button')).toHaveCount(3);
  await expect(panel.locator('.halo-luna-mark').first()).toBeVisible();
  await page.screenshot({ path: info.outputPath(`luna-${appearance}.png`) });
  await panel.getByRole('button', { name: 'Help me understand air quality', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('AQI follows the single worst pollutant');
  await expect(panel.getByRole('link', { name: 'View air quality and references' })).toHaveAttribute('href', /factor\/air/);
  const input = panel.getByRole('textbox', { name: 'Message Luna' });
  await input.fill('Can I ask a question?');
  await input.press('Enter');
  await expect(panel.getByRole('log')).toContainText('This preview does not generate live AI answers.');
  await expect(input).toHaveValue('');
  await panel.getByRole('button', { name: 'Luna options' }).click();
  await panel.getByRole('button', { name: 'About this preview' }).click();
  await expect(panel.locator('.halo-luna-about')).toContainText('Nothing is sent to HALO');
  await panel.getByRole('button', { name: 'Close preview information' }).click();
  await panel.getByRole('button', { name: 'Luna options' }).click();
  await panel.getByRole('button', { name: 'Start a new conversation' }).click();
  await expect(panel.locator('.halo-luna-message')).toHaveCount(0);
  await expect(input).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ask Luna', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.body.style.position)).not.toBe('fixed');
  expect(errors).toEqual([]);
});

test('Luna keeps Homeguard and factor context, missing data and browser Back', async ({ page }) => {
  await page.goto('/foundation/preview/?tab=home&motion=reduce');
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await page.getByRole('button', { name: 'What does my PFAS result mean?', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('not a test of your tap');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goto('/foundation/preview/factor/uv/?scenario=no-data&motion=reduce');
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await page.getByRole('button', { name: 'Help me understand uv index', exact: true }).click();
  await expect(page.getByRole('log')).toContainText('Current readings are unavailable');
  await expect(page.getByRole('log')).not.toContainText('5.2');
  await page.getByRole('link', { name: 'View uv index and references' }).click();
  await expect(page.locator('.halo-ph-detail')).toHaveAttribute('data-factor', 'uv');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Luna offline keeps a draft but cannot send', async ({ page }) => {
  await page.goto('/foundation/preview/?scenario=offline&motion=reduce');
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Message Luna' });
  await input.fill('Keep this draft');
  await input.press('Enter');
  await expect(input).toHaveValue('Keep this draft');
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await expect(page.locator('.halo-luna-message')).toHaveCount(0);
});

test('Luna fits enlarged text and a short mobile viewport, handles multiline and plain text safely', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/foundation/preview/?scale=150&appearance=dark&contrast=true&motion=reduce');
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  const panel = page.getByRole('dialog');
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  await expect(panel).not.toContainText('\u2014');
  const input = panel.getByRole('textbox', { name: 'Message Luna' });
  await input.fill('<script>test</script>');
  await input.press('Shift+Enter');
  await expect(input).toHaveValue('<script>test</script>\n');
  await panel.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('<script>test</script>');
  await expect(panel.getByRole('log').locator('script')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Suggested questions' }).click();
  await expect(panel.locator('.halo-luna-suggestions')).toBeVisible();
  await panel.getByRole('button', { name: 'Suggested questions' }).click();
  await page.setViewportSize({ width: 320, height: 430 });
  await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeInViewport();
  await expect(panel.getByRole('button', { name: 'Close Luna' })).toBeInViewport();
  expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  await page.screenshot({ path: info.outputPath('luna-small.png') });
});
