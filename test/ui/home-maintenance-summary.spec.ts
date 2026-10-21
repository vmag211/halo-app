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
const workspace = (section: string) => `/foundation/preview/expanded?review=tools&tab=home&destination=${section}&appearance=dark&motion=reduce&time=day`;

test('suspected mold uses an explicit observation path without a diagnosis or a new record type', async ({ page }) => {
  await page.goto(workspace('maintenance'));
  // A server-rendered button is inert until hydration, which writes the review settings into the URL.
  await page.waitForURL(/[?&]palette=/);
  await page.getByRole('button', { name:'Record suspected mold', exact:true }).click();
  await expect(page.getByRole('combobox', { name:'Observation type', exact:true })).toHaveValue('other');
  await expect(page.getByLabel('Observation label', { exact:true })).toHaveValue('Suspected mold');
  await expect(page.getByLabel('Measured reading (optional)', { exact:true })).toHaveValue('');
  await page.getByLabel('Observed date and time', { exact:true }).fill('2026-10-01T08:00');
  await page.getByLabel('Room or site label (optional)', { exact:true }).fill('Bathroom ceiling');
  await page.getByLabel('Private note (optional)', { exact:true }).fill('Dark patch noticed after a leak. Needs follow-up.');
  await page.getByRole('button', { name:'Save observation', exact:true }).click();
  await expect(page.getByRole('heading', { name:'Suspected mold', exact:true })).toBeVisible();
  await expect(page.locator('.hg-observation-record')).toContainText('Other observation');
  await expect(page.locator('.hg-observation-record')).toContainText('No measured reading supplied');
  await expect(page.getByText('This observation is separate from the outdoor mold estimate. It is not a mold identification or a diagnosis.', { exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Save to My Week', exact:true })).toBeVisible();
});

test('maintenance saves a cadence and retains a skipped occurrence without completion', async ({ page }) => {
  await page.goto(workspace('maintenance'));
  await page.getByRole('button', { name: /Add a routine/ }).click();
  await page.getByLabel('Asset or routine label').fill('Review bathroom fan');
  await page.getByText('Equipment details · Optional', { exact: true }).click();
  await page.getByLabel('Installation date (optional)').fill('2025-01-01');
  await page.getByLabel('Schedule basis').selectOption('completion');
  await page.getByLabel('Repeat every', { exact: true }).fill('2');
  await page.getByLabel('Interval unit').selectOption('months');
  await page.getByLabel('First or next due date').fill('2025-02-01');
  await page.getByRole('button', { name: 'Save routine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review bathroom fan', exact: true })).toBeVisible();
  await expect(page.getByText('Last completed: Not recorded')).toBeVisible();
  await page.getByRole('button', { name: 'Skip occurrence' }).click();
  const skip = page.getByRole('dialog', { name: 'Skip this occurrence?' });
  await skip.getByLabel('Record date').fill('2025-02-01');
  await skip.getByLabel('What happened (optional)').fill('Waiting for replacement part');
  await skip.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(skip).not.toBeVisible();
  await expect(page.getByText('Last completed: Not recorded')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next due Apr 1, 2025' })).toBeVisible();
  // Readable for people, ISO for machines.
  await expect(page.locator('.hg-routine-overview h2 time')).toHaveAttribute('datetime', '2025-04-01');
  await expect(page.locator('.hg-history')).toContainText('Skipped');
  await page.getByRole('button', { name: 'Record completion' }).click();
  const completion = page.getByRole('dialog', { name: 'Record what you completed' });
  await completion.getByLabel('Record date').fill('2025-04-08');
  await completion.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(completion).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next due Jun 8, 2025' })).toBeVisible();
  await expect(page.locator('.hg-history')).toContainText('Skipped');
  await expect(page.locator('.hg-history')).toContainText('Completed');
  const skippedEntry = page.getByRole('button', { name: 'View skipped occurrence on Feb 1, 2025' });
  await skippedEntry.click();
  const occurrence = page.getByRole('dialog', { name: 'Occurrence details' });
  await expect(occurrence.getByText('Skipped', { exact: true })).toBeVisible();
  await expect(occurrence.getByText('Feb 1, 2025', { exact: true })).toHaveCount(2);
  await expect(occurrence.getByText('Waiting for replacement part', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(occurrence).not.toBeVisible();
  await expect(skippedEntry).toBeFocused();
  await page.getByRole('button', { name: 'View completed occurrence on Apr 8, 2025' }).click();
  await expect(occurrence.getByText('Apr 8, 2025', { exact: true })).toBeVisible();
  await expect(occurrence.getByText('Apr 1, 2025', { exact: true })).toBeVisible();
  await expect(occurrence.getByText('No note recorded', { exact: true })).toBeVisible();
  await occurrence.getByRole('button', { name: 'Back to occurrence history' }).click();
  await expect(occurrence).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Next due Jun 8, 2025' })).toBeVisible();
});

test('moisture keeps a user-entered zero and measured source without a safety result', async ({ page }) => {
  await page.goto(workspace('maintenance'));
  await page.getByRole('button', { name: /Record moisture/ }).click();
  await page.getByLabel('Observation label').fill('Example humidity reading');
  await page.getByLabel('Observation type').selectOption('humidity');
  await page.getByLabel('Observed date and time').fill('2026-09-30T09:15');
  await page.getByLabel('Room or site label (optional)').fill('Example room');
  await page.getByLabel('Measured reading (optional)').fill('0');
  await page.getByLabel('Measurement or observation source').fill('Example hygrometer');
  await page.getByRole('button', { name: 'Save observation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Example humidity reading' })).toBeVisible();
  await expect(page.getByText('0 % RH · User entered', { exact: true })).toBeVisible();
  await expect(page.getByText('Example hygrometer', { exact: true })).toBeVisible();
  await expect(page.getByText(/It is not a mold identification or a diagnosis/)).toBeVisible();
  await page.getByRole('button', { name: 'Save to My Week', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save a practical step' });
  await dialog.getByRole('button', { name: 'Save action' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open saved action' })).toBeVisible();
});

test('summary direct entry has shared records, private defaults, both scores and seven factors', async ({ page }) => {
  await page.goto(workspace('summary'));
  for (const label of ['Test reports', 'Saved actions', 'Maintenance records', 'Moisture observations', 'Garden records']) await expect(page.getByLabel(label, { exact: true })).not.toBeChecked();
  await expect(page.getByLabel('Private notes on selected records')).not.toBeChecked();
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await page.getByText('Review the included information', { exact: true }).click();
  await page.getByText('Other formats & printing', { exact: true }).click();
  const report = page.getByRole('article', { name: 'Selected household summary' });
  await expect(report).toContainText('Today: 74 / 100');
  await expect(report).toContainText('Homeguard: 58 / 100');
  for (const factor of ['Air quality:', 'UV index:', 'Pollen:', 'Mold conditions:', 'PFAS in water:', 'Radon:', 'Lead in plumbing:']) await expect(report).toContainText(factor);
  await expect(report).toContainText('Sample collected March 2025');
  await expect(report).not.toContainText('Kitchen filter upkeep:');
  await expect(report).not.toContainText('Window condensation:');
  await page.getByRole('button', { name: 'Edit included information' }).click();
  await page.getByText('Add private records · Optional', { exact: true }).click();
  await page.getByLabel('Maintenance records', { exact: true }).check();
  await expect(page.getByLabel(/Kitchen filter upkeep/)).toBeChecked();
  await page.getByLabel('Garden records', { exact: true }).check();
  await expect(page.getByLabel(/Back garden/)).toBeChecked();
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await page.getByText('Review the included information', { exact: true }).click();
  await page.getByText('Other formats & printing', { exact: true }).click();
  await expect(report).toContainText('Kitchen filter upkeep:');
  await expect(report).toContainText('Back garden:');
});

test('summary creates real file and image downloads with stable source dates', async ({ page }) => {
  await page.goto(workspace('summary'));
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await page.getByText('Review the included information', { exact: true }).click();
  await page.getByText('Other formats & printing', { exact: true }).click();
  const report = page.getByRole('article', { name: 'Selected household summary' });
  await expect(report.locator('header')).toContainText(/Generated \d{4}-\d{2}-\d{2}T/);
  const filePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download accessible text', exact: true }).click();
  const file = await filePromise;
  expect(file.suggestedFilename()).toBe('halo-household-summary.html');
  expect(await file.failure()).toBeNull();
  const stream = await file.createReadStream();
  const chunks: Buffer[] = []; if (stream) for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const html = Buffer.concat(chunks).toString('utf8');
  expect(html).toContain('Sample collected March 2025');
  expect(html).not.toContain('Preview not yet generated');
  expect(html).not.toContain('Window condensation');
  const imagePromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save image', exact: true }).click();
  const image = await imagePromise;
  expect(image.suggestedFilename()).toBe('halo-household-summary.png');
  expect(await image.failure()).toBeNull();
});

test('private-water and failed optional section keep remaining summary evidence usable', async ({ page }) => {
  await page.goto(workspace('summary'));
  await page.getByLabel('Water context for this summary').selectOption('well');
  await page.getByText('Add private records · Optional', { exact: true }).click();
  await page.getByLabel('Test reports', { exact: true }).check();
  await expect(page.locator('.hg-workspace')).not.toContainText('Review control: optional section failure');
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Simulate summary section failure').selectOption('tests');
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await page.getByText('Review the included information', { exact: true }).click();
  await page.getByText('Other formats & printing', { exact: true }).click();
  const report = page.getByRole('article', { name: 'Selected household summary' });
  await expect(report).toContainText('Homeguard: unavailable for this private-water context');
  await expect(report).toContainText('PFAS in water: missing household measurement');
  await expect(report).toContainText('Omitted: this optional section is unavailable');
  await expect(report).toContainText('Today: 74 / 100');
  await expect(page.getByRole('button', { name: 'Download accessible text' })).toBeEnabled();
});

for (const outcome of ['cancelled', 'denied', 'unsupported'] as const) test(`native share ${outcome} retains the selected preview`, async ({ page }) => {
  await page.addInitScript(state => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: state === 'unsupported' ? undefined : async () => { throw new DOMException('Test device outcome', state === 'cancelled' ? 'AbortError' : 'NotAllowedError'); } });
  }, outcome);
  await page.goto(workspace('summary'));
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await page.getByText('Review the included information', { exact: true }).click();
  await page.getByText('Other formats & printing', { exact: true }).click();
  await page.getByRole('button', { name: 'Share text', exact: true }).click();
  await expect(page.getByText(outcome === 'cancelled' ? 'Sharing cancelled. Your selections are kept.' : outcome === 'denied' ? 'Sharing permission denied. Download a file or image instead.' : 'Native sharing is unsupported in this browser. Download the file or image instead.', { exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Selected household summary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download accessible text' })).toBeEnabled();
});
