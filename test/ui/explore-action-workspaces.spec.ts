import { expect, test, type Page, type Locator } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&motion=reduce&time=day';
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
async function openOutcome(panel: Locator) { await panel.getByRole('button', { name: /Set my goal and next step|Record an update/ }).click(); }
async function recordResult(panel: Locator, result: string) {
  await openOutcome(panel);
  await panel.getByLabel('Where things stand').selectOption('Result recorded');
  await panel.getByLabel('Update date', { exact: true }).fill('2026-10-01');
  await panel.getByLabel('What actually happened').fill(result);
  await panel.getByLabel('My next step').fill('Review the answer and choose a qualified follow-up.');
  await panel.getByLabel('Check-back date (optional)').fill('2026-10-25');
  await panel.getByRole('button', { name: 'Save my update' }).click();
  await expect(panel.locator('.ex-recorded-result')).toContainText(result);
}

test('map preview draws local geography and opens the selected full map without nesting interactive controls', async ({ page }) => {
  await page.goto(root);
  await expect(page.locator('.ex-mini-map-canvas')).toHaveAttribute('data-map-preview-state', 'ready');
  await expect(page.locator('.ex-map-entry a,.ex-map-entry button')).toHaveCount(0);
  await expect(page.locator('.ex-mini-map-canvas canvas')).toHaveAttribute('tabindex', '-1');
  await page.getByRole('group', { name: 'Preview map layer' }).getByRole('button', { name: 'Air', exact: true }).click();
  await page.getByRole('link', { name: /open the full air map/ }).click();
  await expect(page.getByRole('radio', { name: 'Air', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('link', { name: 'Back to Explore' })).toBeVisible();
});

test('failed map preview retains the full-map entry and other feature routes', async ({ page }) => {
  await page.route('**/data/map-preview-geography.json', route => route.abort());
  await page.goto(root);
  await expect(page.locator('.ex-mini-map-canvas')).toHaveAttribute('data-map-preview-state', 'unavailable');
  await expect(page.getByRole('link', { name: /Explore the map/ })).toBeVisible();
  await page.getByRole('button', { name: /WITH YOUR COMMUNITY Get involved/ }).click();
  await expect(page.getByRole('button', { name: 'Add my own opportunity' })).toBeVisible();
});

test('a personally selected opportunity can be prepared, recorded and followed up without an event feed', async ({ page }) => {
  await page.goto(`${root}&destination=opportunities`);
  await page.getByRole('button', { name: 'Add my own opportunity' }).click();
  await page.getByLabel('Opportunity name (required)').fill('My organizer-led sample activity');
  await page.getByLabel('Organizer (required)').fill('Sample stewardship group');
  await page.getByLabel('My preparation and access questions').fill('Ask about accessible paths and supervision.');
  await page.getByRole('button', { name: 'Save my commitment' }).click();
  await expect(page.getByRole('heading', { name: 'My organizer-led sample activity' })).toBeVisible();
  await expect(page.locator('.ex-commitment-detail')).toContainText('No participation or outcome recorded yet');
  await page.getByRole('button', { name: 'Update my commitment' }).click();
  await page.getByLabel('My commitment status').selectOption('Participated');
  await page.getByLabel('Date of this update').fill('2026-10-01');
  await page.getByLabel('What I actually did or learned').fill('I helped with the supervised activity and learned where to find local records.');
  await page.getByLabel('Hours (optional, self-reported)').fill('2');
  await page.getByLabel('Follow-up date (optional)').fill('2026-10-25');
  await page.getByRole('button', { name: 'Save my commitment' }).click();
  await expect(page.locator('.ex-commitment-detail')).toContainText('Time reported by me: 2 hours');
  await page.locator('.ex-followup-band').getByRole('button', { name: 'Save to My Week' }).click();
  await expect(page.getByLabel('All-day date (optional)')).toHaveValue('2026-10-25');
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await expect(page.locator('.ex-followup-band').getByRole('button', { name: 'Open saved action' })).toBeVisible();
});

test('failed commitment save keeps the draft and retry does not create duplicates', async ({ page }) => {
  await page.goto(`${root}&destination=opportunities&exploreView=new`);
  await page.getByLabel('Opportunity name (required)').fill('Retained opportunity');
  await page.getByLabel('Organizer (required)').fill('Example group');
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Explore workspace state').selectOption('save-error');
  await page.getByRole('button', { name: 'Save my commitment' }).click();
  await expect(page.getByLabel('Opportunity name (required)')).toHaveValue('Retained opportunity');
  await page.getByLabel('Explore workspace state').selectOption('ready');
  await page.getByRole('button', { name: 'Save my commitment' }).click();
  await expect(page.getByRole('heading', { name: 'Retained opportunity', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All volunteering routes' }).click();
  await expect(page.locator('.ex-commitment-row')).toHaveCount(1);
});

test('community result validation, saved follow-up and topic independence make learning actionable', async ({ page }) => {
  await page.goto(`${root}&destination=community`);
  const panel = page.locator('.ex-outcome-workspace');
  await openOutcome(panel);
  await panel.getByLabel('Where things stand').selectOption('Result recorded');
  await panel.getByRole('button', { name: 'Save my update' }).click();
  await expect(panel.getByRole('alert')).toContainText('date');
  await panel.getByLabel('Update date', { exact: true }).fill('2026-10-01');
  await panel.getByLabel('What actually happened').fill('I received the dated provider report.');
  await panel.getByLabel('My next step').fill('Review the report with my provider.');
  await panel.getByLabel('Check-back date (optional)').fill('2026-10-25');
  await panel.getByRole('button', { name: 'Save my update' }).click();
  await expect(panel.locator('.ex-recorded-result')).toContainText('dated provider report');
  await panel.getByRole('button', { name: 'Save to My Week' }).click();
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await page.getByRole('group', { name: 'Community topics' }).getByRole('button', { name: 'Air', exact: true }).click();
  await expect(panel.locator('.ex-recorded-result')).toHaveCount(0);
  await page.getByRole('group', { name: 'Community topics' }).getByRole('button', { name: 'Water', exact: true }).click();
  await expect(panel.locator('.ex-recorded-result')).toContainText('dated provider report');
});

test('legacy organizations route opens the combined local participation workspace', async ({ page }) => {
  await page.goto(`${root}&destination=organizations&exploreView=detail&exploreRecord=demo-creek`);
  await expect(page.getByRole('heading', { name: 'Get involved', exact: true })).toBeVisible();
  await expect(page.locator('.ex-subnav')).not.toContainText('Organizations');
  await expect(page.getByRole('button', { name: 'Add my own opportunity' })).toBeVisible();
  await page.getByRole('button', { name: 'Open my notes' }).click();
  await expect(page.getByRole('heading', { name: 'My notes', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Explore sections' }).getByRole('button', { name: 'Get involved', exact: true }).click();
  await expect(page.locator('.ex-local')).toBeVisible();
});

test('project workspace plans selected steps, deduplicates and retains explicit progress through pause and resume', async ({ page }, info) => {
  await page.goto(`${root}&destination=projects&exploreView=detail&exploreRecord=demo-water-project`);
  await page.getByRole('button', { name: 'Start my project workspace' }).click();
  await expect(page.getByRole('button', { name: 'Pause project' })).toBeVisible();
  const plan = page.locator('.ex-project-plan');
  await plan.getByRole('checkbox').nth(0).check(); await plan.getByRole('checkbox').nth(1).check();
  await plan.getByRole('button', { name: 'Review selected steps for My Week' }).click();
  await page.getByRole('button', { name: 'Add selected steps', exact: true }).click();
  await expect(page.locator('.ex-project-step').getByRole('button', { name: 'Open saved action' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark this step completed' }).click();
  await page.getByRole('button', { name: 'Pause project' }).click();
  await expect(page.getByRole('button', { name: 'Reopen this step' })).toBeDisabled();
  await page.getByRole('button', { name: 'Resume project' }).click();
  await expect(page.getByRole('button', { name: 'Reopen this step' })).toBeEnabled();
  await page.locator('.ex-project-step').screenshot({ path: info.outputPath('ongoing-project-step.png') });
  await plan.getByRole('button', { name: 'Review selected steps for My Week' }).click();
  await page.getByRole('button', { name: 'Add selected steps', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week' }).click();
  await expect(page.locator('.halo-expanded-agenda-row')).toHaveCount(2);
  await expect(page.locator('.halo-expanded-agenda-row')).toContainText(['Completed by you', 'Saved in this preview']);
});

test('project completion requires every real step and a result, and Homeguard handoff keeps the same workspace', async ({ page }) => {
  await page.goto(`${root}&destination=projects&exploreView=detail&exploreRecord=demo-water-project`);
  await page.getByRole('button', { name: 'Start my project workspace' }).click();
  const plan = page.locator('.ex-project-plan');
  for (const checkbox of await plan.getByRole('checkbox').all()) await checkbox.check();
  await plan.getByRole('button', { name: 'Review selected steps for My Week' }).click();
  await page.getByRole('button', { name: 'Add selected steps', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Record project completion' })).toBeDisabled();
  for (let index = 0; index < 4; index++) {
    await page.getByRole('button', { name: 'Mark this step completed' }).click();
    if (index < 3) await page.getByRole('button', { name: 'Next project step' }).click();
  }
  await page.getByRole('button', { name: 'Record project completion' }).click();
  await expect(plan.getByRole('alert')).toContainText('actually recorded');
  await page.getByLabel('My project result').fill('I received and reviewed the dated report, then chose a qualified follow-up.');
  await page.getByRole('button', { name: 'Record project completion' }).click();
  await expect(page.locator('.ex-project-workspace > .ex-kicker')).toContainText('Completed');
  await page.getByRole('link', { name: 'Continue into tests and home records' }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Explore', exact: true }).click();
  await page.getByRole('button', { name: /ON YOUR OWN OR TOGETHER Projects/ }).click();
  await page.locator('.ex-project-continuation').getByRole('button').click();
  await expect(page.locator('.ex-project-progress')).toContainText('4 of 4');
  await expect(page.getByLabel('My project result')).toHaveValue(/received and reviewed/);
  await page.getByRole('button', { name: 'Reopen this step' }).click();
  await expect(page.locator('.ex-project-workspace > .ex-kicker')).toContainText('Completion needs review');
});

test('a failed project batch creates no partial tasks and keeps choices', async ({ page }) => {
  await page.goto(`${root}&destination=projects&exploreView=detail&exploreRecord=demo-water-project`);
  const plan = page.locator('.ex-project-plan'); await plan.getByRole('checkbox').nth(0).check();
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Simulate failed action save').check();
  await plan.getByRole('button', { name: 'Review selected steps for My Week' }).click();
  await page.getByRole('button', { name: 'Add selected steps', exact: true }).click();
  await expect(plan.getByRole('checkbox').nth(0)).toBeChecked();
  await expect(plan.getByRole('alert')).toContainText('nothing was added');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week' }).click();
  await expect(page.locator('.halo-expanded-agenda-row')).toHaveCount(0);
});

test('a note case records a factual result, exports deliberately and retains independent follow-up after deletion', async ({ page }) => {
  await page.goto(`${root}&destination=observations&exploreView=detail&exploreRecord=demo-field-note`);
  const panel = page.locator('.ex-outcome-workspace');
  await recordResult(panel, 'I received a reference after contacting the appropriate office.');
  await panel.getByRole('button', { name: 'Save to My Week' }).click();
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await panel.getByRole('button', { name: 'Review my record for export' }).click();
  await expect(panel.locator('.ex-share-preview pre')).toContainText('not independent confirmation');
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await page.getByRole('button', { name: 'Delete A change near the walking path', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.locator('.ex-note-row')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week' }).click();
  await expect(page.locator('.halo-expanded-agenda-row')).toHaveCount(1);
});

test('outreach follows a desired answer and manual reply independently for each recipient', async ({ page }) => {
  await page.goto(`${root}&destination=outreach`);
  const panel = page.locator('.ex-outcome-workspace');
  await recordResult(panel, 'The provider sent a dated report for me to review.');
  await page.getByRole('group', { name: 'Outreach recipient' }).getByRole('button', { name: 'Landlord', exact: true }).click();
  await expect(panel.locator('.ex-recorded-result')).toHaveCount(0);
  await page.getByRole('group', { name: 'Outreach recipient' }).getByRole('button', { name: 'Utility', exact: true }).click();
  await expect(panel.locator('.ex-recorded-result')).toContainText('dated report');
  await expect(panel).toContainText('not read from Gmail');
});

test('a selected public map record becomes a private question with explicit optional Luna evidence context', async ({ page }) => {
  await page.goto('/foundation/preview/map/?edition=expanded&layer=water&system=SAMPLE-01&motion=reduce');
  await page.getByRole('link', { name: 'Keep a question about this record' }).click();
  await expect(page.getByRole('combobox', { name: 'Note type', exact: true })).toHaveValue('Question');
  await expect(page.getByLabel('Your note (required)')).toHaveValue(/public water record for Meadow Water/);
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.ex-public-context')).toContainText('Meadow Water');
  await expect(page.locator('.ex-public-context')).toContainText('not a tap test');
  await expect(page.locator('.ex-public-context').getByRole('link')).toHaveAttribute('href', /system=SAMPLE-01/);
  await page.getByText('Prepare with Luna', { exact: true }).click();
  await expect(page.getByLabel('Selected public map context')).not.toBeChecked();
  await page.getByLabel('Selected public map context').check();
  await page.getByLabel('I choose only these fields for this request').check();
  await page.getByRole('button', { name: 'Preview Luna request' }).click();
  await expect(page.locator('.ex-luna-request pre')).toContainText('not a tap test');
});

test('the home pin cannot be transferred through the public-map question pathway', async ({ page }) => {
  await page.goto('/foundation/preview/map/?edition=expanded&layer=water&system=home&motion=reduce');
  await expect(page.getByRole('dialog', { name: 'Your home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Keep a question about this record' })).toHaveCount(0);
});

for (const appearance of ['light', 'dark']) test(`action workspaces fit 320px enlarged and retain distinct layouts in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  for (const suffix of ['', '&destination=opportunities&exploreView=new', '&destination=community', '&destination=projects&exploreView=detail&exploreRecord=demo-water-project', '&destination=outreach', '&destination=observations&exploreView=detail&exploreRecord=demo-field-note']) {
    await page.goto(`${root}&appearance=${appearance}&scale=150${suffix}`);
    if (suffix.includes('community') || suffix.includes('outreach') || suffix.includes('demo-field-note')) await openOutcome(page.locator('.ex-outcome-workspace'));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), suffix).toBe(true);
    await expect(page.locator('.halo-explore')).not.toContainText('\u2014');
  }
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto(`${root}&appearance=${appearance}&scale=100`);
  await expect(page.locator('.ex-mini-map-canvas')).toHaveAttribute('data-map-preview-state', 'ready');
  await page.evaluate(() => document.fonts.ready);
  for (const photo of await page.locator('.ex-photo img').all()) {
    await photo.scrollIntoViewIfNeeded();
    await expect.poll(() => photo.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: info.outputPath(`explore-action-${appearance}-375.png`), fullPage: true });
});
