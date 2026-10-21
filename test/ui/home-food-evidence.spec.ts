import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=home&destination=food&homeView=pantry&appearance=dark&motion=reduce&time=day';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const faults: string[] = []; errors.set(page, faults);
  page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/') || url.pathname.startsWith('/images/foods/')) { faults.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  await page.goto(root);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
  await expect(page.locator('.hg-pantry img')).toHaveCount(0);
  await expect(page.getByText('Food photos', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No matching photo in this preview.', { exact: true })).toHaveCount(0);
});

test('custom food pre-fills search, saves, edits storage and never invents study matching', async ({ page }) => {
  await page.getByLabel('Find a food').fill('Garden sugar snap peas');
  await page.getByRole('button', { name: 'Add a food of your own' }).click();
  await expect(page.getByLabel('Food name', { exact: true })).toHaveValue('Garden sugar snap peas');
  await page.getByLabel('Food group').selectOption('produce');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Garden sugar snap peas', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /No reviewed pfas study/ })).toBeVisible();
  await expect(page.locator('.hg-food-levels dd')).toHaveText(['Unknown', 'Unknown']);
  await page.getByRole('button', { name: 'Edit food', exact: true }).click();
  await page.getByLabel('Keep in').selectOption('freezer');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('YOUR FREEZER', { exact: true })).toBeVisible();
});

test('food evidence shows units, sample scope and source without converting it to an item level', async ({ page }) => {
  await page.getByLabel('Find a food').fill('salmon');
  await page.getByRole('button', { name: 'Salmon', exact: true }).click();
  await expect(page.locator('.hg-food-portrait')).toHaveCount(0);
  await expect(page.locator('.hg-evidence-metrics')).toContainText('8 of 10');
  await expect(page.locator('.hg-evidence-metrics')).toContainText('ppt (ng/kg)');
  await page.getByText('Sample details and source', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'FDA 2022 seafood survey', exact: true })).toHaveAttribute('href', 'https://www.fda.gov/media/159570/download');
  await expect(page.locator('.hg-evidence-reading')).toContainText('not a measurement or estimate of your food');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.locator('.hg-food-levels dd')).toHaveText(['Unknown', 'Unknown']);
  await page.getByRole('button', { name: 'Lead Guidance available', exact: true }).click();
  await expect(page.getByRole('heading', { name: /No reviewed lead study/ })).toBeVisible();
});

test('milk non-detect is not zero and cherries do not pretend to have study data', async ({ page }) => {
  await page.getByLabel('Find a food').fill('milk');
  await page.getByRole('button', { name: 'Milk', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Lead Study available', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.hg-evidence-reading')).toContainText('27 of 27');
  await expect(page.locator('.hg-evidence-reading')).toContainText('Not detected does not mean zero');
  await page.getByRole('button', { name: 'Food at home', exact: true }).click();
  await page.getByLabel('Find a food').fill('cherries');
  await page.getByRole('button', { name: 'Cherries', exact: true }).click();
  await expect(page.locator('.hg-pantry img')).toHaveCount(0);
  await expect(page.locator('.hg-evidence-metrics')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'PFAS Guidance available', exact: true })).toBeVisible();
});

test('all formerly photographed foods use only icons in search, add, detail and the kitchen', async ({ page }) => {
  for (const name of ['Apples', 'Cherries', 'Milk', 'Salmon', 'Spinach']) {
    await page.getByLabel('Find a food').fill(name);
    const choice = page.getByRole('button', { name, exact: true });
    await expect(choice.locator('.hg-food-thumb svg')).toHaveCount(1);
    await choice.click();
    await expect(page.locator('.hg-pantry img, .hg-food-portrait')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.locator('.hg-pantry img, .hg-food-portrait')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to my kitchen', exact: true }).click();
    await expect(page.getByRole('button', { name: `${name} PFAS Unknown Lead Unknown`, exact: true }).locator('.hg-food-thumb svg')).toHaveCount(1);
    await page.getByRole('button', { name: 'Find a food', exact: true }).click();
  }
});

for (const appearance of ['light', 'dark']) test(`food evidence and custom entry fit 320px at 150 percent in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(root.replace('appearance=dark', `appearance=${appearance}`) + '&scale=150');
  await page.getByLabel('Find a food').fill('spinach');
  await page.getByRole('button', { name: 'Spinach', exact: true }).click();
  await page.getByText('Sample details and source', { exact: true }).click();
  await expect(page.locator('.hg-evidence-tab').first()).toHaveCSS('display', 'block');
  const columns = await page.locator('.hg-evidence-provenance').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.hg-pantry')).not.toContainText('\u2014');
  await page.screenshot({ path: testInfo.outputPath(`food-evidence-${appearance}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Food at home', exact: true }).click();
  await page.getByRole('button', { name: 'Add a food of your own' }).click();
  await page.getByText('Add details (optional)', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('empty food name reopens optional details and focuses the invalid field', async ({ page }) => {
  await page.getByLabel('Find a food').fill('milk');
  await page.getByRole('button', { name: 'Milk', exact: true }).click();
  await page.getByText('Add details (optional)', { exact: true }).click();
  await page.getByLabel('Food name', { exact: true }).fill('');
  await page.getByText('Add details (optional)', { exact: true }).click();
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.getByLabel('Food name', { exact: true })).toBeFocused();
  await expect(page.getByText('Give this food a name.', { exact: true })).toBeVisible();
  await page.getByLabel('Food name', { exact: true }).fill('My milk');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My milk', exact: true })).toBeVisible();
});
