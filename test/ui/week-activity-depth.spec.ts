import { test, expect, type Page } from '@playwright/test';
const root = '/foundation/preview/expanded/?review=tools&tab=plan&motion=reduce';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const faults: string[] = []; errors.set(page, faults); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) { faults.push(`Unexpected request: ${url.pathname}`); return route.abort(); } return route.continue(); });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));
async function review(page: Page) { await page.getByText('Expanded app review · Not approved', { exact: true }).click(); }
async function examples(page: Page) { await review(page); await page.getByRole('button', { name: 'Load connected activity examples', exact: true }).click(); await expect(page.getByRole('status').filter({ hasText: 'Connected activity examples loaded' })).toBeVisible(); await review(page); }

test('connected examples have activity photos, useful step details and a real day timeline', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 900 }); await page.goto(root + '&appearance=dark'); await examples(page);
  await expect(page.locator('.mw-agenda .mw-task')).toContainText('Draw a testable design');
  await expect(page.locator('.mw-agenda .mw-task .ex-photo-solar')).toBeVisible();
  await expect(page.locator('.mw-time-track')).toContainText('9:00');
  await page.locator('.mw-task-open').filter({hasText:'Draw a testable design'}).click();
  const detail = page.locator('#week-task-detail'); await expect(detail.locator('.mw-activity-detail')).toContainText('Build a solar-energy experiment');
  await detail.getByText('How to do this step', { exact: true }).click(); await expect(detail).toContainText('Sketch a box with a dark absorbing surface');
  await expect(detail.getByRole('link', { name: 'NASA', exact: true })).toHaveAttribute('href', 'https://www.nasa.gov/wp-content/uploads/2024/02/nasa-lp-solar-oven.pdf');
  await detail.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.screenshot({ path: info.outputPath('connected-week-phone.png'), fullPage: true });
});

test('project continuation and quick completion use the canonical Explore step', async ({ page }) => {
  await page.goto(root); await examples(page);
  const project = page.locator('[data-progress-id="project:solar-oven"]');
  await expect(project).toContainText('0/4 steps');
  await project.getByRole('button', { name: 'Complete current step of Build a solar-energy experiment', exact: true }).click();
  await expect(project).toContainText('1/4 steps'); await expect(project).toContainText('Assemble the oven in order');
  await project.getByRole('link').click();
  await expect(page).toHaveURL(/destination=projects.*exploreRecord=solar-oven/);
  await expect(page.getByRole('region', { name: 'Current project step' })).toContainText('Assemble the oven in order');
  await page.getByRole('button', { name: 'Previous project step', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen this step', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week', exact: true }).click();
  await expect(page.locator('[data-progress-id="project:solar-oven"]')).toContainText('1/4 steps');
  await review(page); await page.getByRole('button', { name: 'Load connected activity examples', exact: true }).click(); await review(page);
  await expect(page.locator('[data-progress-id="project:solar-oven"]')).toContainText('1/4 steps');
  await expect(page.getByRole('region', { name: 'Saved for later', exact: true }).locator('.mw-task')).toHaveCount(1);
});

test('community example stays illustrative and retains the chosen future date', async ({ page }) => {
  await page.goto(root); await examples(page); await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.locator('.mw-task-open').filter({hasText:'Community cleanup example'}).click();
  const detail = page.locator('#week-task-detail');
  await expect(detail).toContainText('Example meeting place, confirm with organizer');
  await expect(detail).toContainText('Your status is self-reported. Saving is not registration.');
  const date = await detail.getByLabel('Date (optional)', { exact: true }).inputValue();
  expect(new Date(`${date}T12:00:00Z`).getUTCDay()).toBe(6);
  await detail.getByText('My preparation', { exact: true }).click(); await expect(detail).toContainText('No real event availability is loaded');
  await expect(detail.getByRole('link', { name: 'Organizer website', exact: true })).toHaveAttribute('href', /charlottenc.gov/);
});

test('failed and offline example loading makes no record or task changes', async ({ page, context }) => {
  await page.goto(root); await review(page); await page.getByLabel('Simulate failed action save').check();
  await page.getByRole('button', { name: 'Load connected activity examples', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Connected examples could not load' })).toBeVisible();
  await expect(page.locator('[data-progress-id="project:solar-oven"]')).toHaveCount(0);
  await expect(page.locator('.mw-task')).toHaveCount(0); await page.getByLabel('Simulate failed action save').uncheck();
  await context.setOffline(true); await page.getByRole('button', { name: 'Load connected activity examples', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Connected examples could not load' })).toBeVisible();
  await expect(page.locator('[data-progress-id="project:solar-oven"]')).toHaveCount(0); await context.setOffline(false);
});
