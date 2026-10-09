import { test, expect, type Page } from '@playwright/test';

const failures = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });
const root = '/foundation/preview/expanded?appearance=dark&motion=reduce&time=day';
const factor = (key: string, extra = '') => `/foundation/preview/factor/${key}?edition=expanded&appearance=dark&motion=reduce&time=day${extra}`;
const routine = `${root}&tab=home&destination=maintenance&homeView=detail&record=sample-filter`;
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' });

test('revised overview preserves factors and moves navigation ownership', async ({ page }) => {
  await page.goto(root);
  await expect(mainNav(page).getByRole('link')).toHaveText(['Today', 'Homeguard', 'Explore', 'My Week']);
  await expect(page.locator('.halo-ph-factor-grid a')).toHaveCount(4);
  await expect(page.locator('.halo-ph-factor-grid')).not.toContainText('PFAS');
  await mainNav(page).getByRole('link', { name: 'Homeguard' }).click();
  await expect(page.locator('.halo-home-house')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your home workspace' })).toBeVisible();
  await page.getByRole('link', { name: 'Explore Food and Garden' }).click();
  await expect(page.getByRole('heading', { name: 'Food, water & what you grow', exact: true })).toBeVisible();
  await expect(mainNav(page).getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('navigation', { name: 'Homeguard sections' })).toBeVisible();
  await expect(page.getByText('Workflow outline · Not a finished screen')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Homeguard' }).click();
  await expect(page.getByRole('heading', { name: 'Your home workspace' })).toBeVisible();
  await mainNav(page).getByRole('link', { name: 'My Week', exact: true }).click();
  await page.getByRole('link', { name: 'Journal and Patterns' }).click();
  await expect(mainNav(page).getByRole('link', { name: 'My Week' })).toHaveAttribute('aria-current', 'page');
});

test('planned follow-up save, edit, status, deduplication and return are one in-memory action', async ({ page }) => {
  await page.goto(routine);
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save a practical step' });
  await dialog.getByLabel('Action title').fill('Review the kitchen filter schedule');
  await dialog.getByLabel('All-day date (optional)').fill('2026-10-04');
  await dialog.getByRole('button', { name: 'Save sample action' }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Open saved action' }).click();
  await expect(page.getByLabel('Action title')).toHaveValue('Review the kitchen filter schedule');
  await page.getByRole('button', { name: 'Close and keep draft' }).click();
  await mainNav(page).getByRole('link', { name: 'My Week', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your week, with room to breathe' })).toBeVisible();
  await page.getByLabel('Choose a day').fill('2026-10-04');
  await expect(page.locator('.halo-expanded-agenda-row:visible')).toHaveCount(1);
  await page.getByLabel('Status of Review the kitchen filter schedule').first().selectOption('completed');
  await expect(page.getByText('pfas · Completed by you').first()).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Review the kitchen filter schedule' })).toHaveCount(0);
});

test('failure retains edits; Back cancels pending save and retains draft', async ({ page }) => {
  await page.goto(routine);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Simulate failed action save').check();
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  await page.getByLabel('Action title').fill('Review filter instructions');
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('sample save failed');
  await expect(page.getByLabel('Action title')).toHaveValue('Review filter instructions');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('Simulate failed action save').uncheck();
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  await expect(page.getByLabel('Action title')).toHaveValue('Review filter instructions');
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open saved action' })).toBeVisible();
});

test('offline actions cannot save or imply queued work', async ({ page }) => {
  await page.goto(`${routine}&scenario=offline`);
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save sample action' })).toBeDisabled();
  await expect(page.getByText(/this review does not queue saves/)).toBeVisible();
});

test('all factor journeys keep detail sections and show the matching connection', async ({ page }) => {
  for (const key of ['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead']) {
    await page.goto(factor(key));
    await expect(page.getByRole('navigation', { name: 'On this factor page' })).toBeVisible();
    for (const id of ['reading-overview', 'reading-detail', 'protection', 'reading-sources']) await expect(page.locator(`#${id}`)).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Follow through' })).toContainText('A next step, when you need it');
    await expect(page.getByText('Read all steps together')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save this step', exact: true })).toHaveCount(0);
  }
});

test('expanded household Settings requires Save and only selected figures appear', async ({ page }) => {
  await page.goto(`${root}&tab=settings`);
  await expect(page.getByRole('heading', { name: 'Your household', exact: true })).toBeVisible();
  const form = page.locator('form');
  await form.getByLabel('Older adults').uncheck();
  await form.getByLabel('Pregnancy').check();
  await mainNav(page).getByRole('link', { name: 'Homeguard' }).click();
  await expect(page.locator('.halo-home-person[data-member="senior"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.locator('form').getByLabel('Older adults')).not.toBeChecked();
  await form.getByRole('button', { name: 'Save sample household' }).click();
  await mainNav(page).getByRole('link', { name: 'Homeguard' }).click();
  await expect(page.locator('.halo-home-person[data-member="senior"]')).toHaveCount(0);
  await expect(page.locator('.halo-home-person[data-member="pregnant"]')).toHaveCount(1);
});

for (const appearance of ['light', 'dark']) test(`expanded navigation and forms fit 320px at enlarged text in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  for (const tab of ['today', 'home', 'act', 'plan', 'settings']) {
    await page.goto(`/foundation/preview/expanded?tab=${tab}&appearance=${appearance}&motion=reduce&scale=150`);
    await expect(mainNav(page).getByRole('link')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${tab}-${appearance}.png`), fullPage: true });
  }
});
