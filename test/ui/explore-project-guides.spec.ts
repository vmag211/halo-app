import { expect, test } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&destination=projects&motion=reduce&time=day';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('projects generate12 searchable practical ideas with the original guides intact', async ({ page }) => {
  await page.goto(root);
  await expect(page.locator('.ex-guide-entry')).toHaveCount(12);
  await page.getByRole('searchbox', { name: 'Find a project' }).fill('bee house');
  await expect(page.locator('.ex-guide-entry')).toHaveCount(1);
  await page.locator('.ex-generated-open').click();
  await expect(page.getByRole('heading', { name: 'Make a small solitary-bee house', exact: true })).toBeVisible();
  await page.getByText('Materials, permissions and safety', { exact: true }).click();
  await expect(page.locator('.ex-guide-preparation')).toContainText('Opaque emergence box');
  await expect(page.locator('.ex-guide-preparation')).toContainText('Never open, clean or discard occupied nests');
});

for (const [id, source, first, next] of [
  ['demo-habitat-project', 'content.ces.ncsu.edu', 'Sketch the planting area', 'flowers across spring, summer and fall'],
  ['bee-house', 'content.ces.ncsu.edu', 'fewer than 100 tunnels', 'natural reeds or stems'],
  ['community-cleanup', 'www.charlottenc.gov', 'confirm permission, boundaries', 'signed liability waivers'],
  ['solar-oven', 'www.nasa.gov', 'Sketch a box', 'Line the interior sides with foil'],
]) test(`${id} has real instructions and an accessible whole-guide option without duplicated Luna launchers`, async ({ page }) => {
  await page.goto(`${root}&exploreView=detail&exploreRecord=${id}`);
  const step = page.locator('.ex-guide-current-step');
  await expect(step).toContainText(first);
  await expect(step.locator('.ex-guide-step-sources a').first()).toHaveAttribute('href', new RegExp(source));
  await page.getByText('Read the whole guide', { exact: true }).click();
  await expect(page.locator('.ex-guide-scan > ol > li')).toHaveCount(4);
  await expect(page.locator('.ex-guide-scan')).toContainText(next);
  await step.getByRole('button', { name: 'Next project step' }).click();
  await expect(step).toContainText(next);
  await expect(step.getByRole('button', { name: 'Work with Luna', exact: true })).toHaveCount(0);
  await expect(step.getByRole('button', { name: 'Quick note', exact: true })).toHaveCount(0);
});

test('a new project step uses the same My Week action and remains explicit through waiting and resume', async ({ page }) => {
  await page.goto(`${root}&exploreView=detail&exploreRecord=solar-oven`);
  await page.getByRole('button', { name: 'Start my project workspace', exact: true }).click();
  await page.getByText('Choose steps for My Week', { exact: true }).click();
  const plan = page.locator('.ex-project-plan');
  await plan.getByRole('checkbox').first().check();
  await plan.getByRole('button', { name: 'Review selected steps for My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Add selected steps', exact: true }).click();
  await page.getByRole('button', { name: 'Mark this step waiting', exact: true }).click();
  await expect(page.locator('.ex-guide-current-step')).toContainText('Waiting');
  await page.getByRole('button', { name: 'Pause project', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Resume saved step', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Resume project', exact: true }).click();
  await page.getByRole('button', { name: 'Resume saved step', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.locator('.mw-followup > summary').click();
  await page.getByLabel('Include completed items').check();
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toHaveCount(1);
  await expect(page.locator('.mw-agenda .mw-task, .mw-shelf .mw-task')).toContainText('Draw a testable design');
});

test('project preferences regenerate the shared set and keep narrower constraints honest', async ({ page }) => {
  await page.goto(root);
  await page.getByRole('button', { name: 'Make these fit me', exact: true }).click();
  const fit = page.getByRole('dialog', { name: 'Make these projects fit me' });
  await fit.getByLabel('Where could you do this?').selectOption('indoors');
  await fit.getByLabel('Who would take part?').selectOption('solo');
  await fit.getByLabel('Materials and spending').selectOption('reuse');
  await fit.getByRole('button', { name: 'Generate my project ideas', exact: true }).click();
  await expect(page.locator('.ex-project-generating')).toHaveCount(0);
  const count = await page.locator('.ex-generated-item').count();
  expect(count).toBeGreaterThan(0); expect(count).toBeLessThan(12);
  await expect(page.locator('.ex-generated-list')).not.toContainText('Build a solar-energy experiment');
  await page.getByText('Generation details and sources', { exact: true }).click();
  await expect(page.locator('.ex-generation-details')).toContainText('does not invent unsuitable projects');
  await page.getByRole('button', { name: 'Back to Explore', exact: true }).click();
  await expect(page.getByRole('button', { name: `See all ${count}`, exact: true })).toBeVisible();
});

test('refresh varies relevant ideas without creating projects or losing old guide IDs', async ({ page }) => {
  await page.goto(root);
  const first = await page.locator('.ex-generated-item').evaluateAll(items => items.map(item => item.getAttribute('data-project-id')));
  await page.getByRole('button', { name: 'Refresh ideas', exact: true }).click();
  await expect(page.locator('.ex-project-generating')).toHaveCount(0);
  const next = await page.locator('.ex-generated-item').evaluateAll(items => items.map(item => item.getAttribute('data-project-id')));
  expect(next).not.toEqual(first);
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
  await expect(page.locator('.ex-project-continuation')).toHaveCount(0);
  await page.goto(`${root}&exploreView=detail&exploreRecord=demo-water-project`);
  await expect(page.locator('.ex-project-workspace')).toHaveAttribute('data-project-id', 'demo-water-project');
});

test('missing public environmental data never contributes fixture reasons to generation', async ({ page }) => {
  await page.goto(`${root}&scenario=no-data`);
  await expect(page.locator('.ex-generated-item')).toHaveCount(12);
  await page.getByText('Generation details and sources', { exact: true }).click();
  await expect(page.locator('.ex-generation-details > ul')).not.toContainText('Utility water sample');
  await expect(page.locator('.ex-generation-details > ul')).not.toContainText('Sunlight forecast');
  await expect(page.locator('.ex-generation-details > ul')).not.toContainText('Outdoor air');
});

test('project-specific safety is visible and result validation stays beside completion with planning closed', async ({ page }) => {
  await page.goto(`${root}&exploreView=detail&exploreRecord=demo-habitat-project`);
  await expect(page.locator('.ex-guide-safety-note')).toContainText('permission');
  await expect(page.locator('.ex-guide-safety-note')).toBeVisible();
  await page.getByRole('button', { name: 'Start my project workspace', exact: true }).click();
  await page.getByText('Choose steps for My Week', { exact: true }).click();
  const plan = page.locator('.ex-project-plan');
  for (const checkbox of await plan.getByRole('checkbox').all()) await checkbox.check();
  await plan.getByRole('button', { name: 'Review selected steps for My Week', exact: true }).click();
  await page.getByRole('button', { name: 'Add selected steps', exact: true }).click();
  await page.getByText('Choose steps for My Week', { exact: true }).click();
  const step = page.locator('.ex-guide-current-step');
  for (let index = 0; index < 4; index++) {
    await step.getByRole('button', { name: 'Mark this step completed', exact: true }).click();
    await expect(step.getByRole('button', { name: 'Reopen this step', exact: true })).toBeVisible();
    if (index < 3) await step.getByRole('button', { name: 'Next project step' }).click();
  }
  await page.getByText('Record the result and follow-up', { exact: true }).click();
  await page.getByRole('button', { name: 'Record project completion', exact: true }).click();
  await expect(page.locator('.ex-project-reflection [role="alert"]')).toContainText('actually recorded');
  await expect(plan).not.toBeVisible();
  await page.getByLabel('My project result', { exact: true }).fill('I planted two suitable plants and kept a care check.');
  await expect(page.locator('.ex-project-reflection [role="alert"]')).toHaveCount(0);
});

for (const appearance of ['light', 'dark']) test(`project field guides fit 320px with enlarged text in ${appearance}`, async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 850 });
  await page.goto(`${root}&appearance=${appearance}&scale=150&exploreView=detail&exploreRecord=bee-house`);
  await page.getByText('Read the whole guide', { exact: true }).click();
  await page.getByText('Sources and guide limits', { exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(page.locator('.halo-explore')).not.toContainText('\u2014');
  await page.locator('.ex-guide-current-step').screenshot({ path: info.outputPath(`project-guide-${appearance}-320.png`) });
});
