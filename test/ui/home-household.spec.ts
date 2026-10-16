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
  await page.locator('.halo-f-review-tools > summary').click();
  const picker = page.getByRole('group', { name: 'Homeguard sample household' });
  await picker.getByRole('checkbox', { name: 'Adults', exact: true }).check();
  await picker.getByRole('checkbox', { name: 'Older adults', exact: true }).uncheck();
  await expect(page.locator('.halo-home-person[data-member="adult"]')).toBeVisible();
  await expect(page.locator('.halo-home-person[data-member="senior"]')).toHaveCount(0);
  await page.locator('.halo-f-review-tools > summary').click();
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
  await page.locator('.halo-f-review-tools > summary').click();
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
  await page.goto('/foundation/preview/?edition=expanded&tab=home&appearance=dark&motion=reduce');
  await expect(page.locator('.halo-home-person')).toHaveCount(4);
  const before = await page.locator('.halo-environment-score').getAttribute('aria-label');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: /^Home & household/ }).click();
  await page.locator('.halo-settings').getByRole('checkbox', { name: 'Teens', exact: true }).check();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click();
  await expect(page.locator('.halo-home-person[data-member="teen"]')).toBeVisible();
  await expect(page.locator('.halo-environment-score')).toHaveAttribute('aria-label', before!);
});

for (const appearance of ['light', 'dark']) test(`landscape score and architectural guidance remain readable in ${appearance}`, async ({ page }, info) => {
  for (const width of [320, 375, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/foundation/preview/expanded/?tab=home&appearance=${appearance}&motion=reduce&contrast=true&time=day`);
    const landscape = page.locator('.halo-environment-scene');
    await expect(landscape).toBeVisible();
    const scenicBox = (await landscape.boundingBox())!;
    expect(scenicBox.height).toBeGreaterThanOrEqual(350);
    const score = page.getByRole('img', { name: 'Your home score: 58 out of 100', exact: true });
    await expect(score).toBeVisible();
    await expect(score.locator('.halo-score-orbit-value')).toHaveAttribute('stroke-dasharray', '58 42');
    const portrait = page.locator('.halo-home-portrait-art');
    const artwork = (await portrait.boundingBox())!;
    expect(artwork.width / artwork.height).toBeCloseTo(1.5, 1);
    expect(artwork.width).toBeLessThanOrEqual(300);
    for (const person of await page.locator('.halo-home-person').all()) {
      const target = (await person.boundingBox())!;
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeGreaterThanOrEqual(44);
      if (width <= 699) {
        const figure = (await person.locator('.halo-home-figure').boundingBox())!;
        const label = (await person.locator('> span:not(.halo-home-figure)').boundingBox())!;
        expect(label.y).toBeGreaterThanOrEqual(figure.y + figure.height);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width !== 768) {
      await landscape.screenshot({ path: info.outputPath(`landscape-${appearance}-${width}.png`) });
      await page.locator('.halo-home-household').screenshot({ path: info.outputPath(`household-${appearance}-${width}.png`) });
    }
  }
});
