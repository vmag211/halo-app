import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/') || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Preview attempted a live request');
    await route.continue();
  });
});

test('house residents follow selections, navigate separately, and retain review state', async ({ page }) => {
  await page.goto('/foundation/preview/?tab=home&appearance=dark&motion=reduce');
  await expect(page.locator('.halo-home-person')).toHaveCount(4);
  await expect(page.locator('.halo-home-household')).toBeVisible();
  await page.getByText('HALO design review', { exact: true }).click();
  const picker = page.getByRole('group', { name: 'Homeguard sample household' });
  await picker.getByRole('checkbox', { name: 'Adults', exact: true }).check();
  await picker.getByRole('checkbox', { name: 'Older adults', exact: true }).uncheck();
  await expect(page.locator('.halo-home-person[data-member="adult"]')).toBeVisible();
  await expect(page.locator('.halo-home-person[data-member="senior"]')).toHaveCount(0);
  await page.getByText('HALO design review', { exact: true }).click();
  await page.getByRole('link', { name: 'Home guidance for pregnancy', exact: true }).click();
  await expect(page).toHaveURL(/household\/pregnant/);
  await expect(page.locator('.halo-home-member')).toHaveAttribute('data-member', 'pregnant');
  await expect(page.locator('.halo-home-member-action')).toHaveCount(3);
  await page.locator('.halo-home-member-action summary').first().click();
  await expect(page.locator('.halo-home-member-action details[open] a')).toBeVisible();
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.locator('.halo-home-person[data-member="adult"]')).toBeVisible();
  await expect(page.locator('.halo-home-person[data-member="senior"]')).toHaveCount(0);
  expect(new URL(page.url()).search).not.toMatch(/pregnant|respiratory|adult/);
  await page.reload();
  await expect(page.locator('.halo-home-person[data-member="senior"]')).toBeVisible();
});

test('all seven household guides have distinct content and safe missing-data states', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const intros: string[] = [];
  for (const member of ['toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory']) {
    await page.goto(`/foundation/preview/household/${member}/?appearance=light&scenario=no-data&motion=reduce`);
    await expect(page.locator('.halo-home-member')).toHaveAttribute('data-member', member);
    await expect(page.locator('.halo-home-evidence')).toHaveCount(3);
    for (const row of await page.locator('.halo-home-evidence').all()) await expect(row).toContainText('Reading unavailable');
    intros.push(await page.locator('.halo-home-member-hero > p').innerText());
    await expect(page.locator('body')).not.toContainText('\u2014');
    await expect(page.getByRole('link', { name: 'Homeguard', exact: true })).toHaveAttribute('aria-current', 'page');
  }
  expect(new Set(intros).size).toBe(7);
  expect(errors).toEqual([]);
});

for (const appearance of ['light', 'dark']) test(`house and compact cards fit ${appearance} at 320px and enlarged text`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`/foundation/preview/?tab=home&appearance=${appearance}&motion=reduce&scale=150`);
  await expect(page.locator('.halo-home-person')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByText('HALO design review', { exact: true }).click();
  const picker = page.getByRole('group', { name: 'Homeguard sample household' });
  for (const input of await picker.getByRole('checkbox').all()) await input.check();
  await expect(page.locator('.halo-home-person')).toHaveCount(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  for (const input of await picker.getByRole('checkbox').all()) await input.uncheck();
  await expect(page.locator('.halo-home-person')).toHaveCount(0);
  await expect(page.locator('.halo-home-house-empty')).toBeVisible();
  await page.goto(`/foundation/preview/household/respiratory/?appearance=${appearance}&motion=reduce&scale=150`);
  await expect(page.locator('.halo-home-member')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  if (process.env.HALO_HOUSE_SCREENSHOT === '1') {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/foundation/preview/?tab=home&appearance=${appearance}&motion=reduce&time=day`);
    await expect(page.locator('.halo-home-person')).toHaveCount(4);
    await page.locator('.halo-home-household').screenshot({ path: info.outputPath(`house-${appearance}.png`), animations: 'disabled', caret: 'initial' });
    await page.screenshot({ path: info.outputPath(`home-${appearance}.png`), fullPage: true, animations: 'disabled', caret: 'initial' });
  }
});

test('settings selections update the house without changing environmental scores', async ({ page }) => {
  await page.goto('/foundation/preview/?tab=home&appearance=dark&motion=reduce');
  await expect(page.locator('.halo-home-person')).toHaveCount(4);
  const before = await page.locator('.halo-ph-ring-center').innerText();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Teens', exact: true }).click();
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.locator('.halo-home-person[data-member="teen"]')).toBeVisible();
  await expect(page.locator('.halo-ph-ring-center')).toHaveText(before, { useInnerText: true });
});
