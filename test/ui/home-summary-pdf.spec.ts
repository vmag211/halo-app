import { test, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const url = '/foundation/preview/expanded/?tab=home&destination=summary&appearance=dark&motion=reduce&time=day';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(target.hostname) && !target.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('Luna generates a real, paginated PDF locally with a readable fallback', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  const download = page.getByRole('link', { name: 'Download PDF', exact: true });
  await expect(download).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Nothing is sent to AI or uploaded.', { exact: false })).toBeVisible();
  await expect(page.locator('.hg-summary-readable')).not.toHaveAttribute('open');
  const event = page.waitForEvent('download'); await download.click(); const file = await event;
  expect(file.suggestedFilename()).toBe('halo-household-summary.pdf');
  expect(await file.failure()).toBeNull();
  const destination = testInfo.outputPath('household-report.pdf'); await file.saveAs(destination);
  const stream = await file.createReadStream(); const chunks: Buffer[] = [];
  if (stream) for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks); expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  const document = await PDFDocument.load(bytes);
  expect(document.getPageCount()).toBeGreaterThanOrEqual(2);
  expect(document.getTitle()).toBe('HALO household summary');
  expect(document.getPageCount()).toBeLessThan(10);
  await page.locator('.hg-report-builder').screenshot({ path: testInfo.outputPath('report-ready.png') });
  expect(errors).toEqual([]);
});

test('PDF generation can be cancelled and retried without discarding selections', async ({ page }) => {
  let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/fonts/instrument-sans-report.ttf', async route => { await held; await route.continue().catch(() => {}); });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await expect(page.getByRole('progressbar', { name: 'PDF creation progress' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel PDF creation' }).click();
  await expect(page.getByRole('heading', { name: 'Your selections are saved' })).toBeVisible();
  release();
  await page.getByRole('button', { name: 'Try creating PDF again' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible({ timeout: 20000 });
});

test('font failure offers retry and accessible export, not a blank PDF', async ({ page }) => {
  await page.route('**/fonts/instrument-sans-report.ttf', route => route.fulfill({ status: 503, body: '' }));
  await page.goto(url);
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await expect(page.getByRole('region', { name: 'Household PDF' }).getByRole('alert')).toContainText('font could not load');
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toHaveCount(0);
  await page.getByText('Other formats & printing', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download accessible text' })).toBeEnabled();
  await page.unroute('**/fonts/instrument-sans-report.ttf');
  await page.getByRole('button', { name: 'Try creating PDF again' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible({ timeout: 20000 });
});

test('selected test report retains its clarification reason and missing units', async ({ page }, testInfo) => {
  await page.goto(url);
  await page.getByText('Add private records · Optional', { exact: true }).click();
  await page.getByLabel('Test reports', { exact: true }).check();
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
  await page.getByText('Review the included information', { exact: true }).click();
  const report = page.getByRole('article', { name: 'Selected household summary' });
  await expect(report).toContainText('Reported unit and soil sample basis are missing.');
  await expect(report).toContainText('Reported unit missing');
  await expect(report).toContainText('Sample basis missing');
  await expect(report).toContainText('Sample medium: soil. Method: User-reported sample.');
  const event = page.waitForEvent('download'); await page.getByRole('link', { name: 'Download PDF', exact: true }).click();
  const file = await event; await file.saveAs(testInfo.outputPath('selected-tests-report.pdf'));
});

for (const outcome of ['cancelled', 'denied', 'unsupported']) test(`PDF share ${outcome} retains the generated file`, async ({ page }) => {
  await page.addInitScript(state => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => state !== 'unsupported' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Test device outcome', state === 'cancelled' ? 'AbortError' : 'NotAllowedError'); } });
  }, outcome);
  await page.goto(url); await page.getByRole('button', { name: 'Create household PDF' }).click();
  await page.getByRole('button', { name: 'Share PDF', exact: true }).click();
  await expect(page.getByText(outcome === 'cancelled' ? 'Sharing cancelled. Your PDF and selections are still here.' : outcome === 'denied' ? 'Sharing could not finish. Your PDF is still available to download.' : 'PDF sharing is unavailable in this browser. Download the PDF and share it from your files.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible();
});

for (const appearance of ['light', 'dark']) test(`PDF ready panel fits at 320px and enlarged text in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${url.replace('appearance=dark', `appearance=${appearance}`)}&scale=150`);
  await page.getByRole('button', { name: 'Create household PDF' }).click();
  await expect(page.getByRole('link', { name: 'Download PDF', exact: true })).toBeVisible({ timeout: 20000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.locator('.hg-report-builder').screenshot({ path: testInfo.outputPath(`report-${appearance}-320.png`) });
});
