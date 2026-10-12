import { test, expect } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&motion=reduce&time=day';
test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['127.0.0.1', 'localhost'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('renamed navigation, overview paths and map keep Explore ownership', async ({ page }) => {
  await page.goto(root);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveText(['Today', 'Homeguard', 'Explore', 'My Week']);
  await expect(page.getByRole('heading', { name: 'Explore', exact: true })).toBeVisible();
  await expect(page.locator('.halo-companion,.ex-intro,.ex-subnav,.ex-contact-utility,.ex-summary-link')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open my notes' })).toHaveCount(1);
  await expect(nav.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: /Explore the map/ }).click();
  await expect(page.getByRole('link', { name: 'Back to Explore' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Explore' }).click();
  for (const path of ['volunteering', 'projects', 'notes', 'community']) {
    if (path === 'projects') await page.locator('.ex-personalized-preview').getByRole('button', { name: /See all \d+/ }).click();
    else if (path === 'notes') await page.getByRole('button', { name: 'Open my notes', exact: true }).click();
    else await page.locator(path === 'volunteering' ? '.ex-involvement-cover' : '.ex-community-bridge').click();
    await expect(page.getByRole('navigation', { name: 'Explore sections' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Back to Explore', exact: true }).first().click();
  }
  await page.getByLabel('Explore resources', { exact: true }).click();
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await expect(page.getByLabel('Draft for Utility')).toBeVisible();
  await page.getByRole('button', { name: 'Back to Explore', exact: true }).click();
  await page.getByLabel('Explore resources', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Household summary' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'My saved next steps' })).toBeVisible();
});

test('filters retain selections and distinguish no coverage from errors', async ({ page }) => {
  await page.goto(`${root}&destination=organizations`);
  await expect(page.getByRole('heading', { name: 'Get involved', exact: true })).toBeVisible();
  await page.getByLabel('What interests you?').selectOption('Trees & habitat');
  await expect(page.locator('.ex-local-route')).toHaveCount(1);
  await page.getByText('Organizations and other ways to help', { exact: true }).click();
  await page.getByRole('button', { name: 'See how to help: Plant and care for trees together' }).click();
  await page.getByText('Organization, sources and listing review', { exact: true }).click();
  await expect(page.locator('.ex-local-detail')).toContainText('not independent organization verification');
  await page.getByRole('button', { name: 'All programs and organizations' }).click();
  await expect(page.getByLabel('What interests you?')).toHaveValue('Trees & habitat');
  await page.getByText('Location and source coverage', { exact: true }).click();
  await page.getByLabel('Browse reviewed areas').selectOption('elsewhere');
  await expect(page.locator('.ex-opportunity-finder')).toContainText('No reviewed local coverage');
  await expect(page.locator('.ex-local-route')).toHaveCount(0);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Explore workspace state').selectOption('error');
  await expect(page.getByRole('heading', { name: 'Explore could not load' })).toBeVisible();
  await page.getByRole('button', { name: 'Retry sample view' }).click();
  await expect(page.locator('.ex-opportunity-finder')).toContainText('No reviewed local coverage');
  await expect(page.getByLabel('What interests you?')).toHaveValue('Trees & habitat');
});

test('project browsing does not complete steps and saved completion uses My Week', async ({ page }) => {
  await page.goto(`${root}&destination=projects&exploreView=detail&exploreRecord=demo-water-project`);
  await page.getByRole('button', { name: 'Next project step' }).click();
  await expect(page.getByRole('button', { name: 'Mark this step completed' })).toHaveCount(0);
  await page.locator('.ex-project-step').getByRole('button', { name: 'Save to My Week' }).click();
  await page.getByRole('button', { name: 'Save sample action' }).click();
  await page.getByRole('button', { name: 'Mark this step completed' }).click();
  await expect(page.locator('.ex-project-step')).toContainText('Completed by you');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week' }).click();
  await expect(page.locator('.halo-expanded-agenda-row')).toContainText('Completed by you');
});

test('outreach retains independent drafts and private water omits Utility', async ({ page }) => {
  await page.goto(`${root}&destination=outreach`);
  await page.getByLabel('Draft for Utility').fill('Utility draft A');
  await page.getByRole('button', { name: 'Landlord', exact: true }).click();
  await page.getByLabel('Draft for Landlord').fill('Landlord draft B');
  await page.getByRole('button', { name: 'Utility', exact: true }).click();
  await expect(page.getByLabel('Draft for Utility')).toHaveValue('Utility draft A');
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await expect(page.locator('.ex-share-preview pre')).toHaveText('Utility draft A');
  await page.getByText('Template and water context', { exact: true }).click();
  await page.getByLabel('Water context').selectOption('Private well');
  await expect(page.getByRole('button', { name: 'Utility', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Landlord', exact: true }).click();
  await expect(page.getByLabel('Draft for Landlord')).toHaveValue('Landlord draft B');
  await page.getByRole('button', { name: 'Back to Explore', exact: true }).first().click();
  await page.getByLabel('Explore resources', { exact: true }).click();
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await expect(page.getByLabel('Draft for Landlord')).toHaveValue('Landlord draft B');
});

test('field note failure preserves input, successful save and cancellation retain records', async ({ page }) => {
  await page.goto(`${root}&destination=observations`);
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('Title (required)').fill('Example path note');
  await page.getByLabel('Observed date and time (required)').fill('2026-10-01T12:00');
  await page.getByLabel('Factual description (required)').fill('Fictional litter on the path. Cause unknown.');
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Explore workspace state').selectOption('save-error');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.locator('.halo-explore')).toContainText('sample save failed');
  await expect(page.getByLabel('Title (required)')).toHaveValue('Example path note');
  await page.getByLabel('Explore workspace state').selectOption('ready');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByRole('heading', { name: 'Example path note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'All notes' }).click();
  await page.getByRole('button', { name: 'Delete Example path note', exact: true }).click();
  await page.getByRole('button', { name: 'No, keep it', exact: true }).click();
  await expect(page.getByRole('button', { name: /Example path note/ }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Delete Example path note', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Delete Example path note', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /A change near the walking path/ }).first()).toBeVisible();
});

test('outreach sharing cancellation and blocked print retain the selected text', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled in test', 'AbortError'); } });
    window.open = () => null;
  });
  await page.goto(`${root}&destination=outreach`);
  await page.getByLabel('Draft for Utility').fill('Only this selected draft');
  await page.getByRole('button', { name: 'Review what you will share' }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByText('Sharing cancelled. Your draft is still here.')).toBeVisible();
  await page.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.getByText('The print window was blocked. Download the text instead.')).toBeVisible();
  await expect(page.getByLabel('Draft for Utility')).toHaveValue('Only this selected draft');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download text', exact: true }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('halo-explore-draft.txt');
});

test('context photography is local, credited and not represented as a real event', async ({ page }) => {
  await page.goto(root);
  await page.locator('.ex-community-bridge').scrollIntoViewIfNeeded();
  const images = page.locator('.halo-explore .ex-photo img');
  await expect(images).toHaveCount(3);
  for (const image of await images.all()) {
    const src = new URL((await image.getAttribute('src'))!, page.url());
    expect(src.origin).toBe(new URL(page.url()).origin);
    expect(src.pathname).toMatch(/^\/explore\/.*\.webp$/);
    await expect(image).toHaveAttribute('alt', '');
    await expect.poll(() => image.evaluate((node: HTMLImageElement) => node.complete && node.naturalWidth > 0)).toBe(true);
  }
  await expect(page.locator('.halo-explore')).not.toContainText('A morning by the creek');
  await page.getByLabel('Explore resources', { exact: true }).click();
  await page.getByText('About the photos', { exact: true }).click();
  await expect(page.locator('.ex-photo-credits')).toContainText('not photos of the organizations');
  await expect(page.locator('.ex-photo-credits li')).toHaveCount(12);
  await expect(page.locator('.ex-photo-credits')).toContainText('CC BY 2.0');
});

test('photo failure keeps every Explore entry usable', async ({ page }) => {
  await page.route('**/explore/*.webp', route => route.abort());
  await page.goto(root);
  await page.locator('.ex-community-bridge').scrollIntoViewIfNeeded();
  await expect(page.locator('.ex-photo[data-photo-state="unavailable"]')).toHaveCount(3);
  await page.locator('.ex-personalized-preview').getByRole('button', { name: /See all \d+/ }).click();
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Get to know your water/ }).click();
  await expect(page.locator('.ex-project-step')).toBeVisible();
});

test('high contrast preserves every pathway', async ({ page }) => {
  await page.goto(`${root}&contrast=true&scale=150`);
  await expect(page.locator('.ex-personalized-preview .ex-photo')).toBeHidden();
  await expect(page.getByRole('link', { name: /Explore the map/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByLabel('Explore resources', { exact: true }).click();
  await page.getByRole('button', { name: 'Ask a question', exact: true }).click();
  await expect(page.getByLabel('Draft for Utility')).toBeVisible();
});

for (const appearance of ['light', 'dark']) test(`Explore screens fit 320px at 150 percent in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const suffix of ['', '&destination=organizations', '&destination=organizations&exploreView=detail&exploreRecord=demo-creek', '&destination=opportunities', '&destination=community', '&destination=projects&exploreView=detail&exploreRecord=demo-water-project', '&destination=outreach', '&destination=observations', '&destination=observations&exploreView=new', '&destination=observations&exploreView=detail&exploreRecord=demo-field-note']) {
    await page.goto(`${root}&appearance=${appearance}&scale=150${suffix}`);
    await expect(page.locator('.halo-explore')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), suffix).toBe(true);
    await expect(page.locator('.halo-explore')).not.toContainText('\u2014');
  }
  await page.goto(`${root}&appearance=${appearance}&scale=100`);
  await page.setViewportSize({ width: 375, height: 850 });
  await page.screenshot({ path: info.outputPath(`explore-${appearance}.png`), fullPage: true });
  expect(errors).toEqual([]);
});
