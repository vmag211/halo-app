import { expect, test } from '@playwright/test';

const root = '/foundation/preview/expanded/?tab=act&destination=projects&motion=reduce&time=day';

test.beforeEach(async ({ page }) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost', '127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('projects are a searchable catalogue of specific practical work, not generic planning', async ({ page }) => {
  await page.goto(root);
  await expect(page.locator('.ex-guide-entry')).toHaveCount(5);
  await page.getByRole('searchbox', { name: 'Find a project' }).fill('bee house');
  await expect(page.locator('.ex-guide-entry')).toHaveCount(1);
  await page.locator('.ex-guide-entry').click();
  await expect(page.getByRole('heading', { name: 'Make a small solitary-bee house', exact: true })).toBeVisible();
  await expect(page.locator('.ex-guide-preparation')).toContainText('Opaque emergence box');
  await expect(page.locator('.ex-guide-preparation')).toContainText('Never open, clean or discard occupied nests');
});

for (const [id, source, first, next] of [
  ['demo-habitat-project', 'content.ces.ncsu.edu', 'Sketch the planting area', 'flowers across spring, summer and fall'],
  ['bee-house', 'content.ces.ncsu.edu', 'fewer than 100 tunnels', 'natural reeds or stems'],
  ['community-cleanup', 'www.charlottenc.gov', 'confirm permission, boundaries', 'signed liability waivers'],
  ['solar-oven', 'www.nasa.gov', 'Sketch a box', 'Line the interior sides with foil'],
]) test(`${id} has real instructions, an accessible full guide and step-specific Luna help`, async ({ page }) => {
  await page.goto(`${root}&exploreView=detail&exploreRecord=${id}`);
  const step = page.locator('.ex-guide-current-step');
  await expect(step).toContainText(first);
  await expect(step.locator('.ex-guide-step-sources a').first()).toHaveAttribute('href', new RegExp(source));
  await page.getByText('Read the whole guide', { exact: true }).click();
  await expect(page.locator('.ex-guide-scan > ol > li')).toHaveCount(4);
  await expect(page.locator('.ex-guide-scan')).toContainText(next);
  await step.getByRole('button', { name: 'Next project step' }).click();
  await expect(step).toContainText(next);
  await step.getByRole('button', { name: 'Work with Luna', exact: true }).click();
  const luna = page.getByRole('dialog', { name: 'A next step with Luna' });
  await luna.getByRole('button', { name: 'Guide me through this project step', exact: true }).click();
  await luna.getByRole('button', { name: 'Preview Luna response', exact: true }).click();
  await expect(luna.locator('.halo-companion-proposal')).toContainText(next);
  await expect(luna.locator('.halo-companion-proposal')).toContainText('Luna does not check it off');
});

test('a new project step uses the same My Week action and remains explicit through waiting and resume', async ({ page }) => {
  await page.goto(`${root}&exploreView=detail&exploreRecord=solar-oven`);
  await page.getByRole('button', { name: 'Start my project workspace', exact: true }).click();
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
  await expect(page.locator('.halo-expanded-agenda-row')).toHaveCount(1);
  await expect(page.locator('.halo-expanded-agenda-row')).toContainText('Draw a testable design');
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
