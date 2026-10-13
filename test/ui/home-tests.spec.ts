import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const failures = new WeakMap<Page, string[]>();
const root = '/foundation/preview/expanded?tab=home&destination=tests&appearance=dark&motion=reduce';

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; failures.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  await page.goto(root);
});
test.afterEach(async ({ page }) => { expect(failures.get(page)).toEqual([]); });

async function septemberRecord(page: Page) {
  await page.getByRole('button', { name: /^Kitchen tap, September/ }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen tap, September', exact: true })).toBeVisible();
}
async function reviewScenario(page: Page, scenario: string) {
  const control = page.getByLabel('Homeguard workspace state');
  if (!await control.isVisible()) await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await control.selectOption(scenario);
}

test('test preparation, collection, awaiting and result correction preserve originals', async ({ page }) => {
  await page.getByRole('button', { name: /Plan a test/ }).click();
  await page.getByLabel('Test label (required)').fill('Example bathroom water');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Exercise the synthetic report workflow');
  await page.getByLabel('Proposed test date (optional)').fill('2026-10-01');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await expect(page.getByRole('heading', { name: 'Example bathroom water', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'I arranged this test' }).click();
  await page.getByRole('button', { name: 'Record collection', exact: true }).click();
  await page.getByLabel('Collection start date (required)').fill('2026-10-02');
  await page.getByLabel('Sample location label (required)').fill('Example bathroom tap');
  await page.getByLabel('Collection or test method (optional)').fill('Example method A');
  await page.getByRole('button', { name: 'Save collection', exact: true }).click();
  await page.getByRole('button', { name: 'Awaiting result', exact: true }).click();
  await expect(page.getByLabel('Expected result date (optional)')).toHaveValue('');
  await page.getByRole('button', { name: 'Mark awaiting result' }).click();
  await expect(page.getByText(/The result has not arrived/)).toBeVisible();
  await page.getByRole('button', { name: 'Enter results', exact: true }).click();
  await page.getByLabel('Analyte or parameter').fill('Example analyte C');
  await page.getByLabel('Original reported value or text').fill('ND');
  await page.getByLabel('Original reported unit').fill('µg/L');
  await page.getByRole('combobox', { name: 'Reporting qualifier', exact: true }).selectOption('non_detect');
  await page.getByLabel('Detection or reporting limit (optional)').fill('0.5');
  await page.getByLabel('Limit unit (if a limit is given)').fill('µg/L');
  await page.getByLabel('Result or report date').fill('2026-10-03');
  await page.getByLabel('I compared these fields with my original report').check();
  await page.getByRole('button', { name: 'Save confirmed transcription' }).click();
  await expect(page.getByRole('table')).toContainText('Non-detect (ND)');
  await page.getByRole('button', { name: 'Edit recorded results', exact: true }).click();
  await page.getByLabel('Original reported value or text').fill('< 0.5');
  await page.getByRole('combobox', { name: 'Reporting qualifier', exact: true }).selectOption('less_than');
  await page.getByLabel('Correction reason (required)').fill('Original report says less than, not ND');
  await page.getByLabel('I compared these fields with my original report').check();
  await page.getByRole('button', { name: 'Save confirmed transcription' }).click();
  await page.getByRole('button', { name: /Correction history/ }).click();
  await expect(page.getByText('Superseded transcription')).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText('< 0.5');
  await expect(page.getByRole('table').last()).toContainText('Non-detect (ND)');
  await expect(page.getByText(/Reason: Original report says less than, not ND/)).toBeVisible();
});

test('existing report goes directly to results without claiming earlier testing stages happened', async ({ page }) => {
  await page.getByRole('button', { name: /Add a report/ }).click();
  await expect(page.getByRole('heading', { name: 'Add an existing report' })).toBeVisible();
  await page.getByLabel('Test label (required)').fill('Existing example report');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Home or site context (required)').selectOption('sample-current-home');
  await page.getByLabel('Purpose (required)').fill('Keep a report I already received');
  await page.getByRole('button', { name: 'Continue to results' }).click();
  await expect(page.getByRole('heading', { name: 'Enter reported results' })).toBeVisible();
  await page.getByLabel('Analyte or parameter').fill('PFOS');
  await page.getByLabel('Original reported value or text').fill('ND');
  await page.getByRole('combobox', { name: 'Reporting qualifier', exact: true }).selectOption('non_detect');
  await expect(page.getByLabel('Detection or reporting limit (optional)')).toBeVisible();
  await page.getByRole('button', { name: 'Save uninterpreted record' }).click();
  await expect(page.getByRole('heading', { name: 'Existing example report', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('ND');
  const arranged = page.locator('.hg-progress-list li').filter({ has: page.getByText('Arranged', { exact: true }) });
  await expect(arranged).not.toHaveClass(/is-complete/);
  await expect(arranged).toContainText('Not recorded');
  for (const label of ['Collected', 'Awaiting result']) {
    const missing = page.locator('.hg-progress-list li').filter({ has: page.getByText(label, { exact: true }) });
    await expect(missing).not.toHaveClass(/is-complete/);
    await expect(missing).toContainText('Not recorded');
    await expect(missing.getByRole('button')).toHaveCount(0);
  }
  await expect(page.locator('.hg-pill').filter({ hasText: 'Needs clarification' })).toBeVisible();
});

test('failed save retains a draft across Cancel and a later successful edit', async ({ page }) => {
  await reviewScenario(page, 'save-error');
  await septemberRecord(page);
  await page.getByRole('button', { name: 'Edit test details', exact: true }).click();
  await page.getByLabel('Test label (required)').fill('Kitchen tap, corrected label');
  await page.getByRole('button', { name: 'Save test details' }).click();
  await expect(page.getByText(/Could not save/)).toBeVisible();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('Kitchen tap, corrected label');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Leave this form?' }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen tap, September', exact: true })).toBeVisible();
  await reviewScenario(page, 'ready');
  await page.getByRole('button', { name: 'Edit test details', exact: true }).click();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('Kitchen tap, corrected label');
  await page.getByRole('button', { name: 'Save test details' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen tap, corrected label', exact: true })).toBeVisible();
});

test('comparison rejects mismatches and export excludes sample context by default', async ({ page }) => {
  await septemberRecord(page);
  await page.getByRole('button', { name: /Compare records/ }).click();
  await page.getByLabel('Compare with another record').selectOption('test-water-june');
  await expect(page.getByRole('heading', { name: 'Compatible reported values' })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('1.8');
  await page.getByLabel('Compare with another record').selectOption('test-soil');
  await expect(page.getByRole('heading', { name: 'These records are not compatible' })).toBeVisible();
  await expect(page.getByText('Different or unknown sample media.')).toBeVisible();
  await page.getByRole('button', { name: 'Back to test', exact: true }).click();
  await page.getByRole('button', { name: /Export this record/ }).click();
  await expect(page.getByLabel('Include home or site context and sample location')).not.toBeChecked();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('halo-test-record.json');
  const downloadedPath = await download.path();
  expect(downloadedPath).not.toBeNull();
  const exported = JSON.parse(await readFile(downloadedPath!, 'utf8'));
  expect(exported.synthetic).toBe(true);
  expect(exported.rows[0].originalValue).toBe('1.8');
  expect(exported).not.toHaveProperty('contextId');
  expect(exported).not.toHaveProperty('sampleLabel');
  expect(exported.omitted).toContain('File contents');
  await page.getByLabel('Include home or site context and sample location').check();
  await expect(page.locator('.hg-export-preview')).toContainText('sample-current-home');
});

test('archive is reversible and deletion requires Yes after a cancellable confirmation', async ({ page }) => {
  await septemberRecord(page);
  await page.getByRole('button', { name: 'Archive record', exact: true }).click();
  await page.getByRole('dialog', { name: 'Archive this record?' }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Restore from archive' })).toBeVisible();
  await page.getByRole('button', { name: 'All tests', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Kitchen tap, September/ })).toHaveCount(0);
  await page.getByText('Filter records', { exact: true }).click();
  await page.getByLabel('Show archived records').check();
  await septemberRecord(page);
  await page.getByRole('button', { name: 'Delete record', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete this test record?' });
  await dialog.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await page.getByRole('button', { name: 'Delete record', exact: true }).click();
  await dialog.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Home tests & reports', exact: true })).toBeVisible();
  await page.getByLabel('Show archived records').check();
  await expect(page.getByRole('button', { name: /^Kitchen tap, September/ })).toHaveCount(0);
});

test('local report selection is explicitly unuploaded and can be removed', async ({ page }) => {
  await septemberRecord(page);
  await page.getByRole('button', { name: 'Review a local report', exact: true }).click();
  await page.getByLabel('Choose a report').setInputFiles({ name: 'synthetic-report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic report fixture\n%%EOF') });
  await expect(page.getByText('synthetic-report.pdf', { exact: true })).toBeVisible();
  await expect(page.getByText(/PDF viewing is unavailable here/)).toBeVisible();
  await expect(page.getByText(/Uploads and automatic result extraction are unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove local selection' }).click();
  await expect(page.getByText('synthetic-report.pdf', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Choose a report')).toHaveValue('');
  await page.getByLabel('Choose a report').setInputFiles({ name: 'synthetic-report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nSynthetic report fixture\n%%EOF') });
  await expect(page.getByText('synthetic-report.pdf', { exact: true })).toBeVisible();
});

test('record filters survive detail navigation and garden context is explicit', async ({ page }) => {
  await page.getByText('Filter records', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Test kind', exact: true }).selectOption('water');
  await page.getByLabel('Search records').fill('September');
  await septemberRecord(page);
  await page.getByRole('button', { name: 'All tests', exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Test kind', exact: true })).toHaveValue('water');
  await expect(page.getByLabel('Search records')).toHaveValue('September');
  await expect(page.getByRole('button', { name: /^Kitchen tap, June/ })).toHaveCount(0);
  await page.goto(`${root}&homeView=new&record=demo-garden`);
  await expect(page.getByLabel('Home or site context (required)')).toHaveValue('demo-garden');
  await expect(page.getByLabel('Sample medium (required)')).toHaveValue('');
  await page.getByLabel('Test label (required)').fill('Example garden water');
  await page.getByLabel('Sample medium (required)').selectOption('water');
  await page.getByLabel('Purpose (required)').fill('Check the selected site linkage');
  await page.getByRole('button', { name: 'Save test plan' }).click();
  await expect(page.getByText('Site source at recording', { exact: true })).toBeVisible();
  await expect(page.locator('.hg-facts')).toContainText('Unknown (site revision 1)');
});

test('revision conflict keeps local edits and allows deliberate discard after inspecting the saved record', async ({ page }) => {
  await septemberRecord(page);
  await page.getByRole('button', { name: 'Edit test details', exact: true }).click();
  await page.getByLabel('Test label (required)').fill('Conflicting local edit');
  await reviewScenario(page, 'conflict');
  await page.getByRole('button', { name: 'Save test details' }).click();
  await expect(page.getByText(/This record changed\. Your draft is kept/)).toBeVisible();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('Conflicting local edit');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('dialog', { name: 'Leave this form?' }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen tap, September', exact: true })).toBeVisible();
  await expect(page.getByText('Revision 1', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit test details', exact: true }).click();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('Conflicting local edit');
  await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
  await page.getByRole('dialog', { name: 'Discard test edits?' }).getByRole('button', { name: 'Confirm', exact: true }).click();
  await reviewScenario(page, 'ready');
  await page.getByRole('button', { name: 'Edit test details', exact: true }).click();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('Kitchen tap, September');
});
