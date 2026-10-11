import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&motion=reduce';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); } return route.continue(); });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

async function addQuickNote(page: Page, title = 'Native plants in my backyard', description = 'I want native trees and pollinator flowers in a permitted garden.') {
  await page.getByRole('button', { name: 'Quick note', exact: true }).first().click();
  await page.getByLabel('Note title', { exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Your thought', exact: true }).fill(description);
  await page.getByRole('button', { name: 'Save quick note', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
test('quick notes are captured in place and shared with the existing notebook', async ({ page }) => {
  await page.goto(root); await addQuickNote(page);
  await expect(page).not.toHaveURL(/destination=observations/);
  await page.getByRole('button', { name: 'Open my notes' }).click();
  await expect(page.locator('.ex-note-row')).toContainText(['A change near', 'Native plants in my backyard']);
});
test('quick-note save protects pending input and retains failed writing', async ({ page }) => {
  await page.goto(root);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Explore workspace state').selectOption('save-error');
  await page.getByRole('button', { name: 'Quick note', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Keep a thought, right here' });
  await dialog.getByLabel('Note title', { exact: true }).fill('My unfinished idea');
  await dialog.getByRole('textbox', { name: 'Your thought', exact: true }).fill('Keep the full text if saving fails.');
  await dialog.getByRole('button', { name: 'Save quick note' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Your thought', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Close and keep draft' })).toBeDisabled();
  await expect(dialog.getByRole('textbox', { name: 'Your thought', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Close and keep draft' }).click();
  await page.getByRole('button', { name: 'Quick note', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Your thought', exact: true })).toHaveValue('Keep the full text if saving fails.');
});
test('a quick-note draft has exit protection and survives closing its sheet', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: 'Quick note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your thought', exact: true }).fill('An idea to finish later.');
  expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await page.getByRole('button', { name: 'Close and keep draft' }).click();
  await page.getByRole('button', { name: 'Quick note', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Your thought', exact: true })).toHaveValue('An idea to finish later.');
});
test('selected-note project suggestions preserve context privacy and open the real guide', async ({ page }) => {
  await page.goto(root); await addQuickNote(page);
  await page.getByRole('button', { name: 'Work with Luna', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'A next step with Luna' });
  await expect(dialog.getByRole('checkbox', { name: /Native plants in my backyard/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Include selected place labels' })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: /Native plants in my backyard/ }).check();
  await dialog.getByRole('button', { name: 'Preview Luna response' }).click();
  await dialog.getByText('Review the request and selected context', { exact: true }).click();
  await expect(dialog.locator('pre')).toContainText('native trees');
  await expect(dialog.locator('pre')).not.toContainText('cloudier');
  await dialog.getByRole('button', { name: /Plant a native pollinator space/ }).click();
  await expect(page.locator('.ex-project-workspace')).toContainText('Plant a native pollinator space');
  await expect(page.locator('.ex-project-workspace')).toContainText('Gather these');
  await expect(page.locator('.ex-project-workspace')).toContainText('Confirm permission and utility-marking requirements');
});
test('Luna deletion requires exact selection and a second confirmation; cancel retains notes', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'A next step with Luna' });
  await dialog.getByRole('button', { name: 'Delete my selected notes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Preview Luna response' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Select the exact notes');
  await dialog.getByRole('checkbox', { name: /A change near the walking path/ }).check();
  await dialog.getByRole('button', { name: 'Preview Luna response' }).click();
  await dialog.getByRole('button', { name: 'Review deletion' }).click();
  await page.getByRole('dialog', { name: 'Delete these selected notes?' }).getByRole('button', { name: 'No, keep it' }).click();
  await expect(dialog.getByRole('checkbox', { name: /A change near the walking path/ })).toBeChecked();
  await dialog.getByRole('button', { name: 'Review deletion' }).click();
  await page.getByRole('dialog', { name: 'Delete these selected notes?' }).getByRole('button', { name: 'Yes, delete' }).click();
  await expect(dialog).toContainText('Your notebook is empty');
  await expect(dialog.getByRole('checkbox', { name: /A change near/ })).toHaveCount(0);
});
for (const scenario of ['save-error', 'conflict', 'offline']) test(`Luna note removal retains records in ${scenario}`, async ({ page }) => {
  await page.goto(root);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Explore workspace state').selectOption(scenario);
  await page.getByRole('button', { name: 'Work with Luna', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'A next step with Luna' });
  await dialog.getByRole('checkbox', { name: /A change near/ }).check();
  await dialog.getByRole('button', { name: 'Delete my selected notes', exact: true }).click();
  if (scenario === 'offline') { await expect(dialog.getByRole('button', { name: 'Preview Luna response' })).toBeDisabled(); return; }
  await dialog.getByRole('button', { name: 'Preview Luna response' }).click();
  await dialog.getByRole('button', { name: 'Review deletion' }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete these selected notes?' });
  await confirmation.getByRole('button', { name: 'Yes, delete' }).click();
  await expect(confirmation.getByRole('alert')).toBeVisible();
  await confirmation.getByRole('button', { name: 'No, keep it' }).click();
  await expect(dialog.getByRole('checkbox', { name: /A change near/ })).toBeChecked();
});
test('Homeguard quick note survives internal navigation into Explore', async ({ page }) => {
  await page.goto('/foundation/preview/expanded/?tab=home&destination=tests&motion=reduce');
  await addQuickNote(page, 'Native tree idea', 'Look into a native tree for an approved space.');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: 'Open my notes' }).click();
  await expect(page.locator('.ex-note-row')).toContainText(['A change near', 'Native tree idea']);
});
for (const appearance of ['light', 'dark']) test(`connected hub and Luna fit enlarged 320px in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 }); await page.goto(`${root}&appearance=${appearance}&scale=150`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'A next step with Luna' })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`luna-connected-${appearance}.png`) });
});

test('air Patterns are monitor density with stable numbers and controllable illustrative motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/foundation/preview/map/?layer=air&motion=full&appearance=light');
  const atlas = page.getByTestId('map-canvas');
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
  await expect(page.getByRole('button', { name: 'Legend', exact: true })).toContainText('Monitor location density');
  await page.getByRole('button', { name: 'Pause texture' }).click();
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
  await page.getByRole('button', { name: 'Resume texture' }).click();
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
  await page.getByRole('button', { name: 'Locations', exact: true }).click();
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
});
test('reduced motion keeps weather-style contours static', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/foundation/preview/map/?layer=air&motion=full');
  await expect(page.getByTestId('map-canvas')).toHaveAttribute('data-contour-motion', 'paused');
});
test('live motion and contrast preference changes stop and recover the texture', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await page.goto('/foundation/preview/map/?layer=air&motion=full');
  const atlas = page.getByTestId('map-canvas');
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
  await page.emulateMedia({ reducedMotion: 'no-preference', forcedColors: 'active' });
  await expect(atlas).toHaveAttribute('data-contour-motion', 'paused');
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(atlas).toHaveAttribute('data-contour-motion', 'illustrative');
});
