import { test, expect } from '@playwright/test';

const url = (destination: string, view = 'list', appearance = 'dark') => `/foundation/preview/expanded/?tab=home&destination=${destination}&homeView=${view}&appearance=${appearance}&motion=reduce&time=day`;

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(target.hostname) && !target.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

for (const appearance of ['light', 'dark']) test(`refined forms, icons and typography remain aligned in ${appearance}`, async ({ page }, testInfo) => {
  await page.goto(url('tests', 'list', appearance));
  await expect(page.getByRole('heading', { name: 'Home tests & reports' })).toBeVisible();
  const headingFont = await page.locator('[data-home-heading]').evaluate(el => getComputedStyle(el).fontFamily);
  expect(headingFont.toLowerCase()).toContain('onest');
  const searchPadding = await page.getByRole('searchbox', { name: 'Search records' }).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft));
  expect(searchPadding).toBeGreaterThanOrEqual(40);
  await page.getByRole('button', { name: /^Plan a test/ }).click();
  await expect(page.getByRole('button', { name: 'Save test plan' })).toBeVisible();
  await page.goto(`${url('tests', 'results', appearance)}&record=test-water-september`);
  await expect(page.getByRole('button', { name: 'Add result row' })).toBeVisible();
  // Test the shared wrapped Button component, not just workspace-native buttons.
  const wrappedIcons = page.locator('.hg-workspace .halo-button > span:not(.halo-spinner):has(svg)');
  expect(await wrappedIcons.count()).toBeGreaterThan(0);
  for (const item of await wrappedIcons.all()) {
    // A flex item is blockified by CSS, so inline-flex can compute to flex.
    expect(await item.evaluate(el => getComputedStyle(el).display)).toMatch(/^(inline-)?flex$/);
    expect(await item.evaluate(el => getComputedStyle(el).flexDirection)).toBe('row');
  }
  await page.goto(url('food', 'fish', appearance));
  await expect(page.getByRole('heading', { name: 'Know your catch' })).toBeVisible();
  const controls = page.locator('.hg-content select');
  for (const item of await controls.all()) {
    const box = await item.boundingBox();
    expect(box?.width).toBeGreaterThan(250);
    expect(box?.height).toBeLessThan(65);
  }
  await page.locator('.hg-content').screenshot({ path: testInfo.outputPath(`fish-${appearance}.png`) });
  await page.goto(url('summary', 'selection', appearance));
  await page.getByText('Add private records · Optional', { exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Test reports', exact: true })).not.toBeChecked();
  expect(await page.locator('.hg-option > span').first().evaluate(el => getComputedStyle(el).display)).toBe('grid');
  await page.locator('.hg-content').screenshot({ path: testInfo.outputPath(`summary-options-${appearance}.png`) });
});

test('section ambience honors reduced motion and higher contrast', async ({ page }) => {
  for (const destination of ['tests', 'food', 'maintenance', 'summary']) {
    await page.goto(url(destination));
    const artwork = page.locator(destination === 'tests' ? '.hg-test-entry-tools [data-work-art]' : destination === 'maintenance' ? '.hg-care-column > .hg-link [data-work-art]' : '.hg-intro [data-work-art]');
    await expect(artwork.first()).toBeVisible();
    if (['tests', 'maintenance'].includes(destination)) await expect(page.locator('.hg-intro [data-work-art]')).toBeHidden();
    const moving = await artwork.locator('*').evaluateAll(elements => elements.some(el => getComputedStyle(el).animationName !== 'none'));
    expect(moving).toBe(false);
  }
  await page.goto(`${url('food')}&contrast=true`);
  await expect(page.locator('.hg-intro [data-work-art]')).not.toBeVisible();
});

for (const appearance of ['light', 'dark']) test(`garden tools and linked-test actions stay separated at narrow large text in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${url('food', 'garden-detail', appearance)}&record=demo-garden&scale=150`);
  const conditions = page.locator('.hg-garden-conditions');
  await expect(conditions.getByRole('heading', { name: 'Your growing conditions' })).toBeVisible();
  const note = await conditions.locator('.hg-source-note').boundingBox();
  const tools = await conditions.getByRole('group', { name: 'Growing site tools' }).boundingBox();
  expect(note).not.toBeNull(); expect(tools).not.toBeNull();
  expect(tools!.y - (note!.y + note!.height)).toBeGreaterThanOrEqual(16);
  await expect(conditions.getByRole('button', { name: 'Delete site', exact: true })).not.toBeVisible();
  for (const name of ['Edit site', 'Export site brief', 'Plan or record a test', 'Link an existing test']) {
    const control = page.getByRole('button', { name, exact: true });
    const box = await control.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  await page.getByRole('button', { name: 'Link an existing test', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Connect a test', exact: true })).toBeVisible();
  await expect(page.getByLabel('Site label')).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: /Garden soil report/ })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: /Garden soil report/ })).toBeDisabled();
  const testChoice = page.getByRole('checkbox', { name: /^Kitchen tap, September/ });
  await testChoice.check();
  await page.getByRole('button', { name: 'Save test links', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Kitchen tap, September water/ })).toBeVisible();
  const testCard = page.locator('.hg-garden-tests');
  const recordsBox = await testCard.locator('.hg-garden-test-records').boundingBox();
  const actionsBox = await testCard.getByRole('group', { name: 'Connect a test' }).boundingBox();
  expect(actionsBox!.y - (recordsBox!.y + recordsBox!.height)).toBeGreaterThanOrEqual(16);
  await testCard.scrollIntoViewIfNeeded();
  await testCard.screenshot({ path: testInfo.outputPath(`garden-actions-${appearance}-320-150.png`) });
  await page.getByRole('button', { name: 'Link an existing test', exact: true }).click();
  await expect(testChoice).toBeChecked();
  await testChoice.uncheck();
  await page.getByRole('button', { name: 'Save test links', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Back garden', exact: true })).toBeVisible();
  await expect(testCard.getByRole('button', { name: /^Kitchen tap, September water/ })).toHaveCount(0);
  await expect(testCard.getByRole('button', { name: /Garden soil report/ })).toBeVisible();
  // A detached record stays in Tests, and deleting a site still asks for confirmation.
  await conditions.getByText('Manage site', { exact: true }).click();
  await conditions.getByRole('button', { name: 'Delete site', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Delete this growing site?', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await page.getByRole('combobox', { name: 'Home workspace', exact: true }).selectOption('tests');
  await expect(page.getByRole('button', { name: /^Kitchen tap, September/ })).toBeVisible();
});

test('focused garden link editor retains a failed draft and supports retry without changing the report', async ({ page }) => {
  await page.goto(`${url('food', 'garden-links')}&record=demo-garden`);
  const choice = page.getByRole('checkbox', { name: /^Kitchen tap, September/ });
  await choice.check();
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  const state = page.getByLabel('Homeguard workspace state');
  for (const scenario of ['save-error', 'conflict']) {
    await state.selectOption(scenario);
    await page.getByRole('button', { name: 'Save test links', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: scenario === 'save-error' ? 'Could not save' : 'This record changed' })).toBeVisible();
    await expect(choice).toBeChecked();
  }
  await state.selectOption('ready');
  await page.getByRole('button', { name: 'Save test links', exact: true }).click();
  await page.getByRole('button', { name: /^Kitchen tap, September water/ }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen tap, September', exact: true })).toBeVisible();
  await page.locator('.hg-test-context > summary').click();
  await expect(page.getByText('Example home', { exact: true })).toBeVisible();
});
