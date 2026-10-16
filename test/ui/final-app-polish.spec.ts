import {test, expect} from '@playwright/test';

test.beforeEach(async ({page}) => {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return ['localhost','127.0.0.1'].includes(url.hostname) && !url.pathname.startsWith('/api/') ? route.continue() : route.abort();
  });
});

test('product surfaces omit development explanations while external review retains truthful scope', async ({page}) => {
  test.setTimeout(120000); // Twelve full navigations, with every content assertion retained.
  const routes = ['tab=today','tab=home','tab=act','tab=plan','tab=home&destination=tests','tab=home&destination=maintenance','tab=home&destination=food','tab=home&destination=summary','tab=act&destination=projects','tab=act&destination=opportunities','tab=plan&destination=journal','tab=settings'];
  for (const query of routes) {
    await page.goto(`/foundation/preview/expanded/?motion=reduce&${query}`);
    const app = page.getByTestId('foundation-product');
    await expect(app).toBeVisible();
    await expect(app).not.toContainText(/wireframe|design review|this preview|this visit|review session|simulated|sample household|sample workspace/i);
  }
  await page.getByText('Expanded app review · Not approved',{exact:true}).click();
  await expect(page.locator('.halo-f-review-tools')).toContainText('fictional environmental records');
});

test('one primary home workspace precedes the house without removing category guidance', async ({page}, info) => {
  await page.goto('/foundation/preview/expanded/?tab=home&motion=reduce');
  const workspace = page.locator('#home-workspace');
  const house = page.locator('#household');
  await expect(workspace).toHaveCount(1);
  await expect(page.getByText('The people who make it home',{exact:true})).toHaveCount(0);
  const position = await workspace.evaluate((node) => Boolean(node.compareDocumentPosition(document.querySelector('#household')!) & Node.DOCUMENT_POSITION_FOLLOWING));
  expect(position).toBe(true);
  await expect(house).toBeVisible();
  await expect(workspace.getByRole('navigation',{name:'Home workspace features'}).getByRole('link')).toHaveCount(4);
  await workspace.screenshot({path:info.outputPath('home-workspace.png')});
});

test('Homeguard uses the shared calendar with reserved icon space and manual dates', async ({page}, info) => {
  await page.setViewportSize({width:320,height:850});
  await page.goto('/foundation/preview/expanded/?tab=home&destination=tests&homeView=new&appearance=dark&scale=150&motion=reduce');
  const field = page.getByLabel('Proposed test date (optional)',{exact:true});
  await field.fill('2026-10-15');
  const padding = await field.evaluate(node => Number.parseFloat(getComputedStyle(node).paddingRight));
  expect(padding).toBeGreaterThanOrEqual(44);
  await field.locator('..').getByRole('button',{name:'Choose date',exact:true}).click();
  const calendar = page.getByRole('dialog',{name:'Choose a date',exact:true});
  await page.screenshot({path:info.outputPath('home-date-picker-dark-320.png')});
  await calendar.getByRole('button',{name:'Friday, October 16, 2026',exact:true}).click();
  await expect(field).toHaveValue('2026-10-16');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
