import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&motion=reduce';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

for (const appearance of ['light', 'dark']) test(`Explore stays composed inside a narrow app at desktop viewport in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 1260, height: 1000 });
  await page.goto(`${root}&appearance=${appearance}`);
  const app = page.locator('.halo-f-app');
  const lead = page.locator('.ex-generated-lead');
  await expect(lead).toBeVisible();
  const frame = await app.boundingBox(); const bounds = await lead.boundingBox();
  expect(bounds!.width).toBeGreaterThan(frame!.width * .75);
  expect(await page.getByRole('button', { name: 'Quick note', exact: true }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Work with Luna', exact: true }).count()).toBe(0);
  await expect(page.getByRole('heading', { name: 'Explore', exact: true })).toHaveCount(1);
  await page.locator('.ex-generated-lead img').evaluate(async image => { if (image instanceof HTMLImageElement) await image.decode(); });
  await page.screenshot({ path: info.outputPath(`explore-rebuilt-${appearance}.png`) });
});

test('one Luna conversation crosses the full map and Today without creating a second notebook', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Luna', exact: true }).fill('Open the map');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page).toHaveURL(/\/foundation\/preview\/map\//);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Luna', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Luna', exact: true });
  await expect(dialog.getByRole('log')).toContainText('Open the map');
  await dialog.getByRole('button', { name: 'Close sheet', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await expect(dialog.getByRole('log')).toContainText('Open the map');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
});

test('save feedback is brief while failed writing stays visible and editable', async ({ page }) => {
  await page.goto('/foundation/preview/expanded/?tab=home&destination=tests&homeView=new&motion=reduce');
  await page.getByLabel('Test label (required)').fill('Feedback verification');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Verify feedback continuity');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await expect(page.locator('.halo-workspace-toast')).toContainText('Saved for this visit');
  await expect(page.locator('.halo-workspace-toast')).toHaveCount(0, { timeout: 7000 });
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Homeguard workspace state').selectOption('save-error');
  await page.getByRole('button', { name: 'Workspace overview', exact: true }).click();
  await page.getByRole('button', { name: /^Plan a test/ }).click();
  await page.getByLabel('Test label (required)').fill('Retain failed input');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Keep this field after failure');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await expect(page.locator('.halo-workspace-error')).toHaveAttribute('role', 'alert');
  await expect(page.getByLabel('Purpose (required)')).toHaveValue('Keep this field after failure');
  await expect(page.getByLabel('Purpose (required)')).toBeEnabled();
});
