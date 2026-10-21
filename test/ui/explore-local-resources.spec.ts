import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&destination=opportunities&motion=reduce&time=day';
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
async function showPrograms(page: Page) { const summary = page.getByText('Organizations and other ways to help', { exact: true }); if (!await summary.evaluate(element => element.closest('details')?.open)) await summary.click(); }


test('Get involved combines real programs with honest geographic and interest scope', async ({ page }) => {
  await page.goto(root); await showPrograms(page);
  await expect(page.locator('.ex-local-list .ex-local-route')).toHaveCount(5);
  await page.getByText('Location and source coverage', { exact: true }).click();
  await page.getByLabel('Browse reviewed areas').selectOption('union');
  await expect(page.locator('.ex-local-list .ex-local-route')).toHaveCount(1);
  await expect(page.locator('.ex-local-list')).toContainText('N.C. Cooperative Extension');
  await page.getByLabel('Browse reviewed areas').selectOption('charlotte');
  await page.getByLabel('What interests you?').selectOption('Trees & habitat');
  await expect(page.locator('.ex-local-list .ex-local-route')).toHaveCount(1);
  await expect(page.locator('.ex-local-list')).toContainText('TreesCharlotte');
  await expect(page.locator('.ex-opportunity-coverage')).toContainText('not live geocoding');
});

test('an unsupported typed area yields no fabricated nearby matches and preserves official routes', async ({ page }) => {
  await page.goto(root); await showPrograms(page);
  await page.getByRole('button', { name: /Choose an area/ }).click();
  await page.getByLabel('City or county').fill('Boston');
  await page.getByLabel('State', { exact: true }).fill('Massachusetts');
  await page.getByRole('button', { name: 'Use this area' }).click();
  await expect(page.locator('.ex-local-list .ex-local-route')).toHaveCount(0);
  await expect(page.locator('.ex-opportunity-finder')).toContainText('No reviewed local coverage');
  await expect(page.locator('.ex-opportunity-location')).toContainText('Boston, Massachusetts');
  await expect(page.locator('.ex-local-national').getByRole('link', { name: 'Open official opportunities' })).toHaveCount(3);
  await expect(page).not.toHaveURL(/Boston|Massachusetts/);
});

test('a program has specific steps, source-scoped requirements and an office address that is not a meeting point', async ({ page }) => {
  await page.goto(root); await showPrograms(page);
  await page.getByRole('button', { name: 'See how to help: Help care for local waterways' }).click();
  const detail = page.locator('.ex-local-detail');
  await expect(detail.locator('.ex-local-steps li')).toHaveCount(4);
  await expect(detail).toContainText('Under 18 requires an accompanying adult');
  await expect(detail).toContainText('117 Center Street, Cramerton');
  await expect(detail).toContainText('not an event meeting point');
  await expect(detail.getByRole('link', { name: 'Open official participation guide' })).toHaveAttribute('href', 'https://www.catawbariverkeeper.org/volunteer');
  await expect(detail.getByRole('link', { name: 'View this public address' })).toHaveAttribute('href', /117%20Center%20Street/);
});

test('a real program guide becomes an editable private commitment without inventing registration or a date', async ({ page }) => {
  await page.goto(root); await showPrograms(page);
  await page.getByRole('button', { name: 'See how to help: Plant and care for trees together' }).click();
  await page.getByText('My preparation and questions', { exact: true }).click();
  await page.getByLabel('Questions or access needs (private)').fill('A fictional question about a lighter role.');
  await page.getByRole('button', { name: 'Plan my participation' }).click();
  await expect(page.getByLabel('Organizer (required)')).toHaveValue('TreesCharlotte');
  await expect(page.getByLabel('Activity date (optional)')).toHaveValue('');
  await expect(page.getByLabel('My commitment status')).toHaveValue('Considering');
  await expect(page.getByLabel('My preparation and access questions')).toHaveValue(/fictional question/);
  await page.getByRole('button', { name: 'Save my commitment' }).click();
  await expect(page.locator('.ex-commitment-detail')).toContainText('TreesCharlotte');
  await expect(page.locator('.ex-commitment-detail')).toContainText('Considering');
  await expect(page.locator('.ex-commitment-detail')).toContainText('No participation or outcome recorded yet');
});

test('choosing another program protects an unfinished participation draft', async ({ page }) => {
  await page.goto(root); await showPrograms(page);
  await page.getByRole('button', { name: 'See how to help: Start a neighborhood cleanup' }).click();
  await page.getByRole('button', { name: 'Plan my participation' }).click();
  await page.getByLabel('Opportunity name (required)').fill('My unfinished fictional plan');
  await page.getByRole('button', { name: 'Back and keep commitment draft' }).click();
  await page.getByRole('button', { name: 'All programs and organizations' }).click(); await showPrograms(page);
  await page.getByRole('button', { name: 'See how to help: Plant and care for trees together' }).click();
  await page.getByRole('button', { name: 'Plan my participation' }).click();
  await expect(page.getByRole('group', { name: 'Keep or replace participation draft' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my existing draft' }).click();
  await expect(page.getByLabel('Opportunity name (required)')).toHaveValue('My unfinished fictional plan');
});

test('program catalogue and full guide fit 320px with 150 percent text', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${root}&scale=150&appearance=dark`); await showPrograms(page);
  await expect(page.locator('.ex-local-list')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(322);
  await page.getByRole('button', { name: 'See how to help: Help a community garden grow' }).click();
  await expect(page.locator('.ex-local-detail')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(322);
});
