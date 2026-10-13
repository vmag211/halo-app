import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});
async function taskDate(page: Page) {
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add a task', exact: true });
  return { sheet, field: sheet.getByLabel('Date (optional)', { exact: true }) };
}

test('HALO date picker preserves ISO manual entry and selected day events inside a task sheet', async ({ page }) => {
  // Keep the fixture's exact accessible day labels independent of the real date.
  await page.clock.install({ time: new Date('2026-10-12T16:00:00Z') });
  await page.goto(root);
  const { sheet, field } = await taskDate(page);
  await field.fill('2026-10-12');
  await field.locator('..').getByRole('button', { name: 'Choose date', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Choose a date', exact: true });
  await expect(calendar.getByRole('button', { name: /^Monday, October 12, 2026/ })).toHaveAttribute('aria-pressed', 'true');
  await calendar.getByRole('button', { name: 'Tuesday, October 13, 2026', exact: true }).click();
  await expect(field).toHaveValue('2026-10-13');
  await expect(calendar).not.toBeVisible();
  await expect(sheet).toBeVisible();
  await expect(field.locator('..').getByRole('button', { name: 'Choose date', exact: true })).toBeFocused();
  await field.locator('..').getByRole('button', { name: 'Choose date', exact: true }).click();
  await calendar.getByRole('button', { name: 'Clear date', exact: true }).click();
  await expect(field).toHaveValue('');
});

test('calendar arrow keys cross a month and Escape closes only the picker', async ({ page }) => {
  await page.goto(root);
  const { sheet, field } = await taskDate(page);
  await field.fill('2026-10-31');
  await field.locator('..').getByRole('button', { name: 'Choose date', exact: true }).click();
  await page.keyboard.press('ArrowRight');
  const calendar = page.getByRole('dialog', { name: 'Choose a date', exact: true });
  await expect(calendar.getByLabel('Calendar month')).toHaveValue('10');
  await expect(calendar.getByRole('button', { name: 'Sunday, November 1, 2026', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('2026-11-01');
  await field.press('Alt+ArrowDown');
  await expect(calendar).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(calendar).not.toBeVisible();
  await expect(sheet).toBeVisible();
});

for (const appearance of ['light', 'dark']) test(`calendar fits a320px enlarged ${appearance} screen without the native date popup`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${root}&appearance=${appearance}&scale=150`);
  const { field } = await taskDate(page);
  await field.fill('2026-10-12');
  await field.locator('..').getByRole('button', { name: 'Choose date', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Choose a date', exact: true });
  await expect(calendar.getByRole('gridcell')).toHaveCount(42);
  const bounds = (await calendar.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`date-picker-${appearance}-320.png`) });
});

test('Journal date bounds disable future days while preserving existing manual entry', async ({ page }) => {
  await page.goto(`${root}&destination=journal`);
  const field = page.getByLabel('Date', { exact: true });
  const lastDate = await field.getAttribute('max');
  expect(lastDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await field.fill(lastDate!);
  await field.locator('..').getByRole('button', { name: 'Choose date', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Choose a date', exact: true });
  await expect(calendar.locator(`button[data-date="${lastDate}"]`)).toBeEnabled();
  const later = calendar.locator('button[data-date]').filter({ hasText: /^\d+$/ });
  const invalid = await later.evaluateAll((buttons, last) => buttons.filter(button => (button.getAttribute('data-date') ?? '') > last).every(button => (button as HTMLButtonElement).disabled), lastDate!);
  expect(invalid).toBe(true);
});

test('picker Today follows the chosen calendar timezone without shifting a saved date', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-12T07:00:00Z') });
  await page.goto(root);
  // Choose a stored calendar date before changing the display timezone.
  // An untouched initial view follows the newly selected timezone's current day.
  await page.locator('.mw-days button').filter({has:page.locator('strong').filter({hasText:/^12$/})}).click();
  if (await page.locator('.mw-calendar-options').getAttribute('open') === null) await page.locator('.mw-calendar-options > summary').click();
  await page.locator('.mw-calendar-prefs > summary').click();
  await page.getByLabel('Display timezone', { exact: true }).selectOption('Pacific/Honolulu');
  const { field } = await taskDate(page);
  await expect(field).toHaveValue('2026-10-12');
  await field.locator('..').getByRole('button', { name: 'Choose date', exact: true }).click();
  const calendar = page.getByRole('dialog', { name: 'Choose a date', exact: true });
  await expect(calendar.getByRole('button', { name: 'Sunday, October 11, 2026, today', exact: true })).toHaveAttribute('aria-current', 'date');
  await calendar.getByRole('button', { name: 'Today', exact: true }).click();
  await expect(field).toHaveValue('2026-10-11');
});
