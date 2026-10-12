import { test, expect, type Page } from '@playwright/test';
const root = '/foundation/preview/expanded/?tab=act&motion=reduce';
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const faults: string[] = []; errors.set(page, faults); page.on('pageerror', error => faults.push(error.message));
  await page.route('**/*', route => { const url = new URL(route.request().url()); if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) { faults.push(url.pathname); return route.abort(); } return route.continue(); });
});
test.afterEach(async ({ page }) => expect(errors.get(page)).toEqual([]));

test('three core paths have balanced primary presentation and useful entry points', async ({ page }, info) => {
  await page.goto(root);
  const involvement = page.locator('.ex-involvement-cover'); const projects = page.locator('.ex-generated-lead');
  await expect(page.getByRole('heading', { name: 'Get involved', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Projects for you', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Explore the map', exact: true })).toBeVisible();
  const sizes = await page.locator('.ex-fieldwork-layout h3').evaluateAll(headings => headings.map(heading => getComputedStyle(heading).fontSize));
  expect(new Set(sizes).size).toBe(1);
  const first = await involvement.boundingBox(); const second = await projects.boundingBox();
  expect(Math.abs(first!.width - second!.width)).toBeLessThan(2);
  expect(first!.height / second!.height).toBeGreaterThan(.65);
  await expect(page.locator('.ex-mini-map-canvas')).toHaveAttribute('data-map-preview-state', 'ready');
  await page.screenshot({ path: info.outputPath('explore-three-primary-paths.png') });
});

test('interests generate a few relevant illustrated ideas with loading, cancel and retained input', async ({ page }) => {
  await page.goto(`${root}&destination=projects`);
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
  const first = await page.locator('.ex-generated-item').evaluateAll(items => items.map(item => item.getAttribute('data-project-id')));
  await page.getByLabel('What interests you right now?').fill('native plants and pollinators');
  await page.getByRole('button', { name: 'Generate a few ideas' }).click();
  await expect(page.locator('.ex-project-generating')).toContainText('Ideas taking shape');
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
  expect(await page.locator('.ex-generated-item').evaluateAll(items => items.map(item => item.getAttribute('data-project-id')))).toEqual(first);
  await expect(page.getByLabel('What interests you right now?')).toHaveValue('native plants and pollinators');
  await page.getByRole('button', { name: 'Generate a few ideas' }).click();
  await expect(page.locator('.ex-project-generating')).toHaveCount(0);
  await expect(page.locator('.ex-generated-item')).toHaveCount(3);
  await expect(page.locator('.ex-generated-item [data-artwork]')).toHaveCount(3);
});

test('failed generation and unreviewed interests keep the prior set and editable preferences', async ({ page }) => {
  await page.goto(`${root}&destination=projects`);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Project generation review state').selectOption('failed');
  await page.getByLabel('What interests you right now?').fill('native plants');
  await page.getByRole('button', { name: 'Generate a few ideas' }).click();
  await expect(page.locator('.ex-generation-message')).toContainText('Could not generate ideas');
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
  await page.getByLabel('Project generation review state').selectOption('ready');
  await page.getByLabel('What interests you right now?').fill('an aquaponics installation');
  await page.getByRole('button', { name: 'Generate a few ideas' }).click();
  await expect(page.locator('.ex-generation-message')).toContainText('No source-backed match');
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
});

test('slow generation is cancellable and its animation respects reduced motion', async ({ page }) => {
  await page.goto(`${root}&destination=projects`);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Project generation review state').selectOption('slow');
  await page.getByLabel('What interests you right now?').fill('native plants');
  await page.getByRole('button', { name: 'Generate a few ideas' }).click();
  await expect(page.locator('.ex-project-generating')).toBeVisible();
  expect(await page.locator('.ex-generation-leaf').first().evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await expect(page.getByRole('button', { name: 'Make these fit me', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).click();
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
});

test('a newer Luna request wins over a pending Explore generation', async ({ page }) => {
  await page.goto(`${root}&destination=projects`);
  await page.getByText('Expanded app review · Not approved', { exact: true }).click();
  await page.getByLabel('Project generation review state').selectOption('slow');
  await page.getByLabel('What interests you right now?').fill('native plants');
  await page.getByRole('button', { name: 'Generate a few ideas' }).click();
  await page.getByRole('button', { name: 'Ask Luna', exact: true }).click();
  await page.getByRole('textbox', { name: 'Message Luna', exact: true }).fill('Find 5 project ideas for a bee house');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Luna', exact: true }).locator('.lc-message--assistant')).toContainText('I prepared 5 project ideas');
  await page.getByRole('button', { name: 'Close sheet', exact: true }).click();
  await expect(page.locator('.ex-generated-item')).toHaveCount(5);
  await expect(page.locator('.ex-generation-message')).toContainText('Another project request updated your ideas');
  await expect(page.locator('.ex-generated-item')).toHaveCount(5);
});

test('chosen location overrides a previous manually browsed area and filters real dated/rolling snapshots', async ({ page }) => {
  await page.goto(`${root}&destination=opportunities`);
  await expect(page.locator('.ex-opportunity-card')).toHaveCount(4);
  await page.getByRole('combobox', { name: 'When?', exact: true }).selectOption('rolling');
  await expect(page.locator('.ex-opportunity-card')).toHaveCount(2);
  await page.getByText('Location and source coverage', { exact: true }).click();
  await page.getByLabel('Browse reviewed areas').selectOption('charlotte');
  await page.getByRole('button', { name: 'Choose an area', exact: true }).click();
  await page.getByRole('textbox', { name: 'City or county', exact: true }).fill('Monroe');
  await page.getByRole('textbox', { name: 'State', exact: true }).fill('North Carolina');
  await page.getByRole('button', { name: 'Use this area', exact: true }).click();
  await expect(page.locator('.ex-opportunity-card')).toHaveCount(0);
  await expect(page.getByLabel('Browse reviewed areas')).toHaveValue('auto');
  await expect(page.locator('.ex-opportunity-finder')).toContainText('No matching upcoming listings');
  expect(page.url()).not.toContain('Monroe');
});

test('opportunity essentials, source handoff and participation draft are connected without registration claims', async ({ page }) => {
  await page.goto(`${root}&destination=opportunities`);
  await page.locator('[data-opportunity-id="charlotte-anytime"]').click();
  const detail = page.locator('.ex-opportunity-detail');
  await expect(detail).toContainText('What you’ll do'); await expect(detail).toContainText('Charlotte city limits');
  await expect(detail.locator('[data-artwork]')).toHaveAttribute('data-artwork', 'cleanup');
  await expect(detail.getByRole('link', { name: 'Check details & registration' })).toHaveAttribute('href', /charlottenc\.gov/);
  await expect(detail).toContainText('Opening it does not register you');
  await page.getByRole('button', { name: 'Plan my participation' }).click();
  await expect(page.getByLabel('Opportunity name (required)')).toHaveValue('Cleanup Litter Anytime');
  await expect(page.getByLabel('Activity date (optional)')).toHaveValue('');
});

for (const appearance of ['light', 'dark']) test(`illustrated discovery and project details fit 320px enlarged in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  for (const suffix of ['&destination=opportunities', '&destination=projects', '&destination=projects&exploreView=detail&exploreRecord=solar-oven']) {
    await page.goto(`${root}&appearance=${appearance}&scale=150${suffix}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(page.locator('.halo-explore')).not.toContainText('\u2014');
  }
  await page.screenshot({ path: info.outputPath(`project-solar-${appearance}.png`), fullPage: true });
});
