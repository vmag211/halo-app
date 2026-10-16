import { test, expect, type Page } from '@playwright/test';

const root = '/foundation/preview/expanded/?review=tools&tab=act&motion=reduce';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); } return route.continue(); });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));
async function open(page: Page) { await page.getByRole('button', { name: 'Ask Luna', exact: true }).click(); return page.getByRole('dialog', { name: 'Luna', exact: true }); }
async function say(page: Page, text: string) { await page.getByRole('textbox', { name: 'Message Luna', exact: true }).fill(text); await page.getByRole('button', { name: 'Send message', exact: true }).click(); }
async function reviewControl(page: Page, label: string, value: string | boolean) {
  const dialog = page.getByRole('dialog', { name: 'Luna', exact: true });
  const resume = await dialog.isVisible();
  if (resume) await dialog.getByRole('button', { name: 'Close sheet', exact: true }).click();
  const summary = page.getByText('Expanded app review · Not approved', { exact: true });
  const control = page.getByRole(typeof value === 'boolean' ? 'checkbox' : 'combobox', { name: label, exact: true });
  if (!await control.isVisible()) await summary.click();
  if (typeof value === 'boolean') await control.setChecked(value);
  else await control.selectOption(value);
  await summary.click();
  if (resume) await open(page);
}

test('Luna creates and edits one canonical task through an inline conversation review', async ({ page }) => {
  await page.goto(root); const dialog = await open(page);
  await say(page, 'Create a task: check the garden on 2026-10-12');
  await expect(dialog.getByLabel('Task title')).toHaveValue('check the garden');
  await expect(dialog.getByLabel('All-day date', { exact: true })).toHaveValue('2026-10-12');
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(dialog.locator('.lc-receipt')).toContainText('Saved in My Week');
  const id = await dialog.locator('.lc-receipt').getAttribute('data-record-id'); expect(id).toBeTruthy();
  await say(page, 'Move that task to 2026-10-13');
  await dialog.getByRole('button', { name: 'Save change', exact: true }).click();
  await expect(dialog.locator('.lc-receipt')).toHaveCount(2);
  expect(await dialog.locator('.lc-receipt').last().getAttribute('data-record-id')).toBe(id);
  await dialog.getByRole('button', { name: 'Close sheet', exact: true }).click();
  await page.getByRole('link', { name: 'My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  if (await page.locator('.mw-calendar-options').getAttribute('open') === null) await page.locator('.mw-calendar-options > summary').click();
  await page.locator('.mw-followup > summary').click();
  await page.getByLabel('Include completed items').check();
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toHaveCount(1);
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toContainText('check the garden');
});

test('Luna retains conversation and input across closing and cross-tab navigation', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Find local ways to volunteer');
  await dialog.getByRole('textbox', { name: 'Message Luna', exact: true }).fill('My next question');
  await dialog.getByRole('button', { name: 'Close sheet', exact: true }).click();
  await page.getByRole('link', { name: 'Homeguard', exact: true }).click(); await open(page);
  await expect(dialog).toContainText('programme examples, not matches to your location');
  await expect(dialog.getByRole('textbox', { name: 'Message Luna', exact: true })).toHaveValue('My next question');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
});

test('Luna saves to the existing notebook and confirms exact named deletion', async ({ page }) => {
  await page.goto(root); const dialog = await open(page);
  await say(page, 'Save a note: Native flowers for my planter. Ask about suitable species.');
  await dialog.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(dialog.locator('.lc-receipt')).toContainText('Note saved');
  await say(page, 'Delete the note titled Native flowers for my planter');
  const review = dialog.getByRole('region', { name: 'Note deletion review' });
  await expect(review).toContainText('Native flowers for my planter');
  await review.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await say(page, 'Delete the note titled Native flowers for my planter');
  await dialog.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(dialog).toContainText('Selected note removed');
  await say(page, 'Open my notes');
  await expect(page).toHaveURL(/destination=observations/);
  await expect(page.locator('.ex-note-row')).toContainText(['A change near the walking path']);
  await expect(page.locator('.ex-note-row')).not.toContainText(['Native flowers for my planter']);
});

test('Natural scheduling shows an editable date with the disclosed timezone anchor', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Create a task: build the experiment tomorrow');
  await expect(dialog.getByLabel('All-day date', { exact: true })).toHaveValue(/\d{4}-\d{2}-\d{2}/);
  await expect(dialog).toContainText('Tomorrow, based on');
  await expect(dialog).toContainText('America/New_York');
  await say(page, '2026-10-13');
  await expect(dialog.getByLabel('All-day date', { exact: true })).toHaveValue('2026-10-13');
});

test('Luna reviews remain intact after a failed save', async ({ page }) => {
  await page.goto(root);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Explore workspace state').selectOption('save-error');
  const dialog = await open(page); await say(page, 'Create a task: review the source');
  await dialog.getByRole('button', { name: 'Save task', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save');
  await expect(dialog.getByRole('alert')).toContainText('Nothing changed');
  await expect(dialog.getByLabel('Task title')).toHaveValue('review the source');
  await expect(dialog.locator('.lc-receipt')).toHaveCount(0);
});

test('Luna returns a shared personalized shortlist and opens the real project browser', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Find 12 project ideas based on my home');
  await expect(dialog.locator('.lc-projects button')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'View all 12 project ideas', exact: true }).click();
  await expect(page).toHaveURL(/destination=projects/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Luna starts a real project and one canonical preparation action without marking completion', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Start the solar oven project on 2026-10-17');
  await expect(dialog).toContainText('Build a solar-energy experiment');
  await dialog.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(dialog.locator('.lc-receipt')).toContainText('Project workspace started with its preparation in My Week');
  await expect(dialog.locator('.lc-receipt')).toHaveAttribute('data-record-id', 'solar-oven');
  await dialog.locator('.lc-receipt').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.ex-project-workspace')).toContainText('0 of');
  await expect(page.locator('.ex-project-workspace')).toContainText('Pause project');
  await page.getByRole('link', { name: 'My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  if (await page.locator('.mw-calendar-options').getAttribute('open') === null) await page.locator('.mw-calendar-options > summary').click();
  await page.locator('.mw-followup > summary').click();
  await page.getByLabel('Include completed items').check();
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toHaveCount(1);
});

test('Luna refuses diagnosis and answers water questions with sample scope and primary sources', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Do I have poisoning from my PFAS reading?');
  await expect(dialog).toContainText('not a medical tool');
  await say(page, 'What does this water reading mean?');
  await expect(dialog).toContainText('March 2025');
  await expect(dialog).toContainText('not a current test of your tap');
  await dialog.getByText('Sources and scope', { exact: true }).click();
  await expect(dialog.getByRole('link', { name: 'EPA: Find a consumer confidence report' })).toHaveAttribute('href', 'https://www.epa.gov/ccr');
});

test('Luna shows scoped real organization programmes instead of claiming live nearby events', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Find local ways to volunteer');
  await expect(dialog.locator('.lc-local article')).toHaveCount(3);
  await expect(dialog).toContainText('not matches to your location');
  await expect(dialog.locator('.lc-local')).toContainText('Keep Charlotte Beautiful');
  await expect(dialog.locator('.lc-local')).toContainText('not an event meeting point');
});

test('Service cancel restores the question and retry does not duplicate the user message', async ({ page }) => {
  await page.goto(root); await reviewControl(page, 'Assistant service review state', 'slow'); const dialog = await open(page);
  await say(page, 'Find project ideas');
  await expect(dialog.getByRole('button', { name: 'New conversation', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Assistant service review state')).toHaveCount(0);
  await expect(page.getByLabel('Assistant service review state')).not.toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel request', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: 'Message Luna' })).toHaveValue('Find project ideas');
  await reviewControl(page, 'Assistant service review state', 'unavailable');
  await say(page, 'Find local ways to volunteer');
  await reviewControl(page, 'Assistant service review state', 'ready');
  await dialog.getByRole('button', { name: 'Retry request', exact: true }).click();
  await expect(dialog.locator('.lc-message--user')).toHaveCount(2);
  await expect(dialog.locator('.lc-local article')).toHaveCount(3);
});

test('A failed project request keeps the existing generated batch unchanged', async ({ page }) => {
  await page.goto(root); const dialog = await open(page); await say(page, 'Find 12 project ideas');
  await expect(dialog.getByRole('button', { name: 'View all 12 project ideas', exact: true })).toBeVisible();
  await reviewControl(page, 'Assistant service review state', 'unavailable');
  await say(page, 'Find 10 project ideas');
  await expect(dialog).toContainText('Luna is unavailable');
  await dialog.getByRole('button', { name: 'View all 12 project ideas' }).click();
  await expect(page).toHaveURL(/destination=projects/);
  await expect(page.locator('.ex-generated-title')).toContainText('12 practical ideas');
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
});

test('Missing environmental readings never become fixture-based personal explanations', async ({ page }) => {
  await page.goto(root + '&scenario=no-data'); await page.getByRole('button',{name:'Settings',exact:true}).click(); await page.getByRole('button',{name:/^Luna & connections/}).click(); await page.getByRole('switch',{name:'Home record context',exact:true}).check(); await page.getByRole('button',{name:'Save changes',exact:true}).click(); await page.getByRole('link',{name:'My Week',exact:true}).click(); const dialog = await open(page); await say(page, 'What does this water reading mean?');
  await expect(dialog).toContainText('reading is unavailable');
  await expect(dialog).not.toContainText('8.3 ppt');
  await say(page, 'Find project ideas');
  await expect(dialog).toContainText('without unavailable environmental readings');
  await expect(dialog.locator('.lc-projects')).toContainText('You recorded an indoor moisture observation');
});

test('A partial project-start failure can cancel preparation without denying the saved project', async ({ page }) => {
  await page.goto(root); await reviewControl(page, 'Simulate project preparation save failure', true); const dialog = await open(page);
  await say(page, 'Start the solar oven project on 2026-10-17');
  await dialog.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('workspace was started, but the preparation task was not saved');
  await dialog.getByRole('button', { name: 'Cancel review' }).click();
  await expect(dialog.locator('.lc-receipt')).toContainText('unsaved preparation review was cancelled; the project remains');
  await say(page, 'Open the solar oven project');
  await expect(page).toHaveURL(/exploreRecord=solar-oven/);
  await expect(page.locator('.ex-project-workspace')).toContainText('Pause project');
  await page.getByRole('link', { name: 'My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  if (await page.locator('.mw-calendar-options').getAttribute('open') === null) await page.locator('.mw-calendar-options > summary').click();
  await page.locator('.mw-followup > summary').click();
  await page.getByLabel('Include completed items').check();
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toHaveCount(0);
});

test('Partial project preparation can retry once without a second workspace or duplicate task', async ({ page }) => {
  await page.goto(root); await reviewControl(page, 'Simulate project preparation save failure', true); const dialog = await open(page);
  await say(page, 'Start the solar oven project on 2026-10-17');
  await dialog.getByRole('button', { name: 'Start project', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('preparation task was not saved');
  await reviewControl(page, 'Simulate project preparation save failure', false);
  await dialog.getByRole('button', { name: 'Save preparation', exact: true }).click();
  await expect(dialog.locator('.lc-receipt')).toContainText('Project workspace started with its preparation in My Week');
  await dialog.locator('.lc-receipt').getByRole('button', { name: 'Open', exact: true }).click();
  await expect(page.locator('.ex-project-workspace')).toContainText('0 of');
  await page.getByRole('link', { name: 'My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  if (await page.locator('.mw-calendar-options').getAttribute('open') === null) await page.locator('.mw-calendar-options > summary').click();
  await page.locator('.mw-followup > summary').click();
  await page.getByLabel('Include completed items').check();
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toHaveCount(1);
});

test('Luna protects an unfinished draft on browser exit and retains it across closing', async ({ page }) => {
  await page.goto(root); const dialog = await open(page);
  await dialog.getByRole('textbox', { name: 'Message Luna' }).fill('My unfinished private question');
  await expect.poll(() => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await dialog.getByRole('button', { name: 'Close sheet', exact: true }).click();
  await open(page); await expect(dialog.getByRole('textbox', { name: 'Message Luna' })).toHaveValue('My unfinished private question');
  await dialog.getByRole('textbox', { name: 'Message Luna' }).fill('');
  await say(page, 'Create a task: an unfinished review');
  await expect.poll(() => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
  await dialog.getByRole('button', { name: 'Cancel review' }).click();
  await expect.poll(() => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
});

for (const appearance of ['light', 'dark']) test(`Luna conversation fits 320px in ${appearance} appearance`, async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 }); await page.goto(root + `&appearance=${appearance}`); const dialog = await open(page);
  await say(page, 'Create a task: review a very long environmental project title without losing any meaningful words on 2026-10-12');
  const bounds = await dialog.boundingBox(); expect(bounds!.width).toBeLessThanOrEqual(320);
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Save task', exact: true })).toBeVisible();
});
