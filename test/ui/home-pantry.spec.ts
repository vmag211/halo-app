import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?review=tools&tab=home&destination=food&homeView=pantry&appearance=dark&motion=reduce&time=day';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  await page.goto(root);
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));
async function openNoteForm(page: Page) {
  await page.getByText('Food group guides', { exact: true }).click();
  await page.getByRole('button', { name: /Fish & seafood Salmon/ }).click();
  await page.getByRole('button', { name: 'Self-caught', exact: true }).click();
  await page.getByText('Keep a food note', { exact: true }).click();
}
async function reviewState(page: Page, state: string) {
  const control = page.getByLabel('Homeguard workspace state');
  if (!await control.isVisible()) await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await control.selectOption(state);
}

test('food search returns guidance, missing search stays unknown and invalid guide stays unavailable', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Food at home', exact: true })).toBeVisible();
  await expect(page.locator('.hg-individual-foods .hg-food-pick')).toHaveCount(12);
  await expect(page.getByText(/It cannot detect PFAS or lead/)).toBeVisible();
  await page.getByLabel('Find a food').fill('salmon');
  await expect(page.locator('.hg-individual-foods .hg-food-pick')).toHaveCount(1);
  await page.getByRole('button', { name: 'Salmon', exact: true }).click();
  await page.getByText('Sample details and source', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'FDA 2022 seafood survey', exact: true })).toHaveAttribute('href', /fda.gov\/media/);
  await page.getByRole('button', { name: 'Lead Guidance available', exact: true }).click();
  await expect(page.getByRole('link', { name: 'FDA: lead in food', exact: true })).toHaveAttribute('href', /lead-food-and-foodwares/);
  await page.getByRole('button', { name: 'Food at home', exact: true }).click();
  await expect(page.getByLabel('Find a food')).toHaveValue('salmon');
  await page.getByLabel('Find a food').fill('not-reviewed-food');
  await expect(page.getByText(/Missing from the catalogue does not mean free of PFAS or lead/)).toBeVisible();
  await page.getByRole('button', { name: 'Clear food search' }).click();
  await expect(page.locator('.hg-individual-foods .hg-food-pick')).toHaveCount(12);
  await page.goto(root.replace('homeView=pantry', 'homeView=pantry-detail') + '&record=unavailable');
  await expect(page.getByRole('heading', { name: 'This food guide is unavailable' })).toBeVisible();
});

test('food origins select matching guidance with real sources separate from fixture workflows', async ({ page }) => {
  await page.getByText('Food group guides', { exact: true }).click();
  await page.getByRole('button', { name: /Fruit & vegetables Apples/ }).click();
  await page.getByRole('button', { name: 'Homegrown', exact: true }).click();
  await expect(page.getByRole('button', { name: /Open My garden Connect/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'NC State Extension: PFAS and home gardens' })).toHaveAttribute('href', /ces.ncsu.edu/);
  await page.getByRole('button', { name: 'Food at home', exact: true }).click();
  await page.getByText('Food group guides', { exact: true }).click();
  await page.getByRole('button', { name: /Fish & seafood Salmon/ }).click();
  await page.getByRole('button', { name: 'Self-caught', exact: true }).click();
  await expect(page.getByText(/FDA recommends checking state fish and shellfish advisories/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Find official state advisory sources' })).toHaveAttribute('href', /epa.gov/);
  await page.getByRole('button', { name: 'Bought', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open FDA recalls and safety alerts' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Explore fish advisories/ })).toHaveCount(0);
});

test('food note saves escaped user text, edits it and deletes only after confirmation', async ({ page }) => {
  await openNoteForm(page);
  const label = 'Example <img src=x onerror=alert(1)> fish';
  await page.getByLabel('Food note name').fill(label);
  await page.getByLabel('Question to keep').fill('Which advisory applies to this example catch?');
  await page.getByRole('button', { name: 'Save food note', exact: true }).click();
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
  await expect(page.locator('.hg-pantry img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit note', exact: true }).click();
  await page.getByLabel('Food note name').fill('Example revised catch');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example revised catch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All food notes', exact: true }).click();
  await expect(page.getByRole('button', { name: /Example revised catch Self-caught/ })).toBeVisible();
  await page.getByRole('button', { name: /Example revised catch Self-caught/ }).click();
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example revised catch', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keep a question for later' })).toBeVisible();
});

test('offline and failed food saves retain the draft without fabricating persistence', async ({ page }) => {
  await openNoteForm(page);
  await page.getByLabel('Food note name').fill('Example saved catch');
  await reviewState(page, 'offline');
  await expect(page.getByRole('button', { name: 'Save food note', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Food note name')).toHaveValue('Example saved catch');
  await reviewState(page, 'save-error');
  await page.getByRole('button', { name: 'Save food note', exact: true }).click();
  await expect(page.getByText(/Could not save/)).toBeVisible();
  await expect(page.getByLabel('Food note name')).toHaveValue('Example saved catch');
  await reviewState(page, 'ready');
  await page.getByRole('button', { name: 'Save food note', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example saved catch', exact: true })).toBeVisible();
});

test('food note My Week action has one stable identity through opening and editing', async ({ page }) => {
  await openNoteForm(page);
  await page.getByLabel('Food note name').fill('Example catch question');
  await page.getByRole('button', { name: 'Save food note', exact: true }).click();
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open saved action', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit note', exact: true }).click();
  await page.getByLabel('Food note name').fill('Example renamed question');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open saved action', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save to My Week', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Open saved action', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Update action', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save action', exact: true })).toHaveCount(0);
});

for (const appearance of ['light', 'dark']) test(`food catalogue and details fit 320px with large text in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(root.replace('appearance=dark', `appearance=${appearance}`) + '&scale=150');
  await expect(page.getByRole('heading', { name: 'Food at home', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByText('Food group guides', { exact: true }).click();
  await page.getByRole('button', { name: /Fish & seafood Salmon/ }).click();
  await page.getByRole('button', { name: 'Self-caught', exact: true }).click();
  await page.getByText('Keep a food note', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.hg-pantry')).not.toContainText('\u2014');
  await page.screenshot({ path: testInfo.outputPath(`food-guide-${appearance}.png`), fullPage: true });
  await page.getByRole('button', { name: 'Food at home', exact: true }).click();
  await page.getByLabel('Find a food').fill('milk');
  await page.getByRole('button', { name: 'Milk', exact: true }).click();
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await page.getByRole('button', { name: 'Back to my kitchen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Milk PFAS Unknown Lead Unknown', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const levelSizes = await page.locator('.hg-kitchen-item .hg-food-levels').evaluateAll(items => items.map(item => ({ width: item.clientWidth, content: item.scrollWidth })));
  expect(levelSizes.every(size => size.content <= size.width + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`kitchen-${appearance}-320.png`), fullPage: true });
});

test('virtual kitchen saves a food with unknown levels, moves it, and removes only after confirmation', async ({ page }) => {
  await page.getByLabel('Find a food').fill('milk');
  await page.getByRole('button', { name: 'Milk', exact: true }).click();
  await page.getByText('Add details (optional)', { exact: true }).click();
  await page.getByLabel('Food origin', { exact: true }).selectOption('store');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Milk', exact: true })).toBeVisible();
  await expect(page.locator('.hg-food-levels dt')).toHaveText(['PFAS', 'Lead']);
  await expect(page.locator('.hg-food-levels dd')).toHaveText(['Unknown', 'Unknown']);
  await page.getByRole('button', { name: 'Back to my kitchen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Milk PFAS Unknown Lead Unknown', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Milk PFAS Unknown Lead Unknown', exact: true }).click();
  await page.getByRole('button', { name: 'Edit food', exact: true }).click();
  await page.getByLabel('Keep in', { exact: true }).selectOption('freezer');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('YOUR FREEZER', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove food', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Milk', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Remove food', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your kitchen', exact: true })).toBeVisible();
  await expect(page.locator('.hg-kitchen-item')).toHaveCount(0);
});

test('food add errors keep draft and never create a false kitchen item', async ({ page }) => {
  await page.getByLabel('Find a food').fill('oatmeal');
  await page.getByRole('button', { name: 'Oats', exact: true }).click();
  await page.getByText('Add details (optional)', { exact: true }).click();
  await page.getByLabel('Food name', { exact: true }).fill('Example oats');
  await page.getByLabel('Keep in', { exact: true }).selectOption('pantry');
  await reviewState(page, 'save-error');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.getByText(/Could not save/)).toBeVisible();
  await expect(page.getByLabel('Food name', { exact: true })).toHaveValue('Example oats');
  await reviewState(page, 'offline');
  await expect(page.getByRole('button', { name: 'Add to my kitchen', exact: true })).toBeDisabled();
  await reviewState(page, 'ready');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await page.getByRole('button', { name: 'Back to my kitchen', exact: true }).click();
  await expect(page.locator('.hg-kitchen-item')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Example oats PFAS Unknown Lead Unknown', exact: true })).toBeVisible();
});

test('inventory needs no question and still offers an editable useful My Week follow-up', async ({ page }) => {
  await page.getByLabel('Find a food').fill('milk');
  await page.getByRole('button', { name: 'Milk', exact: true }).click();
  await page.getByText('Add details (optional)', { exact: true }).click();
  await expect(page.getByLabel('Question to keep (optional)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Milk', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit food', exact: true }).click();
  await expect(page.getByLabel('Question to keep (optional)', { exact: true })).toHaveValue('');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByText('A POSSIBLE NEXT STEP', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Check whether a current PFAS or lead notice applies to Milk.');
  await page.getByRole('dialog').getByRole('button', { name: 'Save action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open saved action', exact: true })).toBeVisible();
});
