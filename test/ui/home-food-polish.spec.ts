import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const root = '/foundation/preview/expanded/?review=tools&tab=home&destination=food&appearance=dark&motion=reduce&time=day';
const faults = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; faults.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
});
test.afterEach(async ({ page }) => expect(faults.get(page)).toEqual([]));

for (const appearance of ['light', 'dark']) test(`fish extent toggle stays compact with readable labels at 320px in ${appearance}`, async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 850 });
  for (const record of ['demo-local-fish', 'demo-state-fish']) {
    await page.goto(root.replace('appearance=dark', `appearance=${appearance}`) + `&scale=150&homeView=fish-detail&record=${record}`);
    const toggle = page.getByRole('button', { name: 'View extent diagram', exact: true });
    await toggle.click();
    const openToggle = page.getByRole('button', { name: 'Hide extent diagram', exact: true });
    const icon = await openToggle.locator('svg').boundingBox();
    expect(icon?.width).toBeLessThanOrEqual(20);
    expect(icon?.height).toBeLessThanOrEqual(20);
    expect((await openToggle.boundingBox())?.height).toBeLessThan(125);
    await expect(page.locator('.hg-extent figure')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await openToggle.click();
    await expect(page.locator('.hg-extent figure')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'View extent diagram', exact: true }).click();
  await page.locator('.hg-extent').screenshot({ path: testInfo.outputPath(`extent-${appearance}.png`) });
});

test('food evidence keeps exact source details without repeating the same guidance accordion', async ({ page }, testInfo) => {
  await page.goto(root + '&homeView=pantry-add&record=salmon');
  await expect(page.locator('.hg-evidence-metrics')).toContainText('8 of 10');
  await expect(page.locator('.hg-evidence-caution')).toContainText('below 16 ng/kg, not proven zero');
  await expect(page.getByText('PFAS and lead: what we know', { exact: true })).toHaveCount(0);
  await expect(page.locator('.hg-pantry img')).toHaveCount(0);
  const caution = await page.locator('.hg-evidence-caution').boundingBox();
  const next = await page.locator('.hg-evidence-next').boundingBox();
  expect(next!.y - (caution!.y + caution!.height)).toBeGreaterThanOrEqual(15);
  await page.getByText('Sample details and source', { exact: true }).click();
  await expect(page.locator('.hg-evidence-reading')).toContainText('Eight of ten Atlantic salmon samples');
  await expect(page.locator('.hg-evidence-provenance')).toContainText('LC-MS/MS');
  await expect(page.getByRole('link', { name: 'FDA 2022 seafood survey', exact: true })).toBeVisible();
  await page.locator('.hg-food-evidence').screenshot({ path: testInfo.outputPath('food-evidence-spaced.png') });
});

test('changing a waterbody search cannot leave stale advisory matches', async ({ page }) => {
  await page.goto(root + '&homeView=fish');
  await page.getByLabel('Lake or river').selectOption('demo-willow-lake');
  await page.getByRole('combobox', { name: 'Species', exact: true }).selectOption('Largemouth bass');
  await expect(page.getByRole('heading', { name: 'Related advisory references' })).toBeVisible();
  await page.getByLabel('Search a waterbody', { exact: false }).fill('not-a-waterbody');
  await expect(page.getByLabel('Lake or river')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Choose a waterbody and species.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Willow Lake, north basin Waterbody-specific/ })).toHaveCount(0);
});

test('sharing a public food reference copies and downloads the same scoped payload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(root + '&homeView=fish-detail&record=demo-local-fish');
  await page.getByRole('button', { name: 'Share reference', exact: true }).click();
  await page.getByRole('button', { name: 'Copy reference', exact: true }).click();
  await expect(page.getByText('Reference copied.', { exact: true })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download reference', exact: true }).click();
  const download = await downloadPromise;
  const downloaded = await readFile((await download.path())!, 'utf8');
  // Windows normalizes clipboard line endings; the exported content must otherwise match.
  expect(downloaded.replace(/\r\n/g, '\n')).toBe(copied.replace(/\r\n/g, '\n'));
  expect(JSON.parse(downloaded)).toEqual({ sourceStatus: 'unverified', title: 'Willow Lake, north basin', version: 2, record: { sourceAvailable: false } });
});

test('moving a food opens its new kitchen section and keeps delete near the record heading', async ({ page }) => {
  await page.goto(root + '&homeView=pantry-add&record=milk');
  await page.getByRole('button', { name: 'Add to my kitchen', exact: true }).click();
  const toolbar = page.getByRole('group', { name: 'Food record tools' });
  await expect(toolbar.getByRole('button', { name: 'Remove food', exact: true }).locator('svg.lucide-trash-2')).toHaveCount(1);
  await toolbar.getByRole('button', { name: 'Edit food', exact: true }).click();
  await page.getByLabel('Keep in', { exact: true }).selectOption('freezer');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByRole('button', { name: 'Back to my kitchen', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Kitchen storage' }).getByRole('button', { name: /Freezer/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Milk PFAS Unknown Lead Unknown', exact: true })).toBeVisible();
});

test('usage deletion is confirmed and failed deletes remain visible inside the dialog', async ({ page }) => {
  await page.goto(root + '&homeView=usage-detail&record=demo-use-1');
  const deleteButton = page.getByRole('button', { name: 'Delete record', exact: true });
  await expect(deleteButton.locator('svg.lucide-trash-2')).toHaveCount(1);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Homeguard workspace state').selectOption('save-error');
  await deleteButton.click();
  const dialog = page.getByRole('dialog', { name: 'Delete this usage record?' });
  await dialog.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Could not save. Your draft is kept.');
  await dialog.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'August water bill', exact: true })).toBeVisible();
  await page.getByLabel('Homeguard workspace state').selectOption('ready');
  await deleteButton.click();
  await dialog.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your water use', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /August water bill 2700/ })).toHaveCount(0);
});

test('food reference mutations are unavailable offline without hiding source access', async ({ page }) => {
  await page.goto(root + '&homeView=fish-detail&record=demo-local-fish');
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Homeguard workspace state').selectOption('offline');
  await expect(page.getByRole('button', { name: 'Save reference', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Follow updates', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Share reference', exact: true })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Official fish advisory resources', exact: true })).toBeVisible();
});

test('deleting a private food question keeps the source and clears only the saved question', async ({ page }) => {
  await page.goto(root + '&homeView=evidence-detail&record=demo-notice');
  await page.getByLabel('Question for the issuer or producer').fill('Does this example cover the lot on my label?');
  await page.getByRole('button', { name: 'Save private question', exact: true }).click();
  await expect(page.getByText('Question saved.', { exact: true })).toBeVisible();
  const remove = page.getByRole('button', { name: 'Delete private question', exact: true });
  await expect(remove.locator('svg.lucide-trash-2')).toHaveCount(1);
  await remove.click();
  await page.getByRole('dialog', { name: 'Delete this question?' }).getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByLabel('Question for the issuer or producer')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Packaged-food notice reference', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save reference', exact: true })).toBeEnabled();
});

test('deleting an inquiry leaves the resource available and clears private progress', async ({ page }) => {
  await page.goto(root + '&homeView=grower-detail&record=lab');
  await page.getByLabel('Questions to ask, optional').fill('Which container should I use?');
  await page.getByRole('button', { name: 'Save inquiry progress', exact: true }).click();
  await expect(page.getByText('Private preparation saved. No agency submission was made.', { exact: true })).toBeVisible();
  const remove = page.getByRole('button', { name: 'Delete inquiry record', exact: true });
  await expect(remove.locator('svg.lucide-trash-2')).toHaveCount(1);
  await remove.click();
  await page.getByRole('dialog', { name: 'Delete this inquiry record?' }).getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByLabel('Questions to ask, optional')).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Drinking-water laboratory guidance', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open contact options', exact: true })).toBeEnabled();
});

test('deleting a garden preserves its linked test record', async ({ page }) => {
  await page.goto(root + '&homeView=garden-detail&record=demo-garden');
  await expect(page.getByRole('button', { name: /Garden soil report soil/ })).toBeVisible();
  await page.getByText('Manage site', { exact: true }).click();
  const remove = page.getByRole('button', { name: 'Delete site', exact: true });
  await expect(remove.locator('svg.lucide-trash-2')).toHaveCount(1);
  await remove.click();
  await expect(page.getByRole('dialog')).toContainText('linked test record stays');
  await page.getByRole('dialog').getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No growing sites yet.', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Home workspace', exact: true }).selectOption('tests');
  await expect(page.getByRole('button', { name: /Garden soil report/ }).first()).toBeVisible();
});

for (const appearance of ['light', 'dark']) test(`Food and Garden branches fit 320px and large text in ${appearance}`, async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 320, height: 850 });
  const branches = [
    ['list'], ['pantry'], ['pantry-custom'], ['pantry-add', 'salmon'], ['pantry-detail', 'seafood'],
    ['gardens'], ['garden-detail', 'demo-garden'], ['garden-new'], ['garden-edit', 'demo-garden'], ['garden-links', 'demo-garden'],
    ['fish'], ['fish-detail', 'demo-local-fish'], ['fish-notes'], ['fish-note-new'],
    ['evidence'], ['evidence-detail', 'demo-notice'], ['growers'], ['grower-detail', 'lab'],
    ['water'], ['usage'], ['usage-detail', 'demo-use-1'], ['usage-new'], ['usage-edit', 'demo-use-1'],
  ];
  for (const [view, record] of branches) {
    await page.goto(root.replace('appearance=dark', `appearance=${appearance}`) + `&scale=150&homeView=${view}${record ? `&record=${record}` : ''}`);
    await expect(page.locator('[data-home-heading]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), view).toBe(true);
    await expect(page.locator('.hg-workspace')).not.toContainText('\u2014');
    await expect(page.locator('.hg-workspace img')).toHaveCount(0);
  }
});
