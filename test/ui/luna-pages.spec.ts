import { test, expect } from '@playwright/test';

const expanded = '/foundation/preview/expanded/?appearance=dark&motion=reduce';
const pages = [
  ...['today', 'home', 'act', 'plan', 'settings'].map(tab => `${expanded}&tab=${tab}`),
  ...['tests', 'maintenance', 'food', 'summary'].map(destination => `${expanded}&tab=home&destination=${destination}`),
  ...['outdoors', 'journal'].map(destination => `${expanded}&tab=plan&destination=${destination}`),
  ...['opportunities', 'projects', 'outreach', 'observations'].map(destination => `${expanded}&tab=act&destination=${destination}`),
  ...['pantry', 'fish', 'gardens', 'evidence', 'growers', 'water', 'usage'].map(homeView => `${expanded}&tab=home&destination=food&homeView=${homeView}`),
  `${expanded}&tab=home&destination=tests&homeView=results&record=test-water-september`,
  `${expanded}&tab=home&destination=maintenance&homeView=detail&record=sample-filter`,
  `${expanded}&tab=home&destination=food&homeView=pantry-detail&record=seafood`,
  ...['air', 'uv', 'pollen', 'mold', 'pfas', 'radon', 'lead'].map(factor => `/foundation/preview/factor/${factor}/?edition=expanded&motion=reduce`),
  '/foundation/preview/family/?edition=expanded&motion=reduce',
  '/foundation/preview/household/toddler/?edition=expanded&motion=reduce',
  '/foundation/preview/map/?motion=reduce',
];

test('Luna opens and closes without losing the page across the shared app and subpages', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname.startsWith('/api/')) { errors.push(`Unexpected request: ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  for (const path of pages) {
    await page.goto(path);
    const launcher = page.getByRole('button', { name: /^(Ask|Open) Luna$/ });
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveCount(1);
    await expect.poll(async()=>{const box=await launcher.boundingBox();return !!box&&box.x>=0&&box.x+box.width<=375;}).toBe(true);
    const original = new URL(page.url());
    await launcher.click();
    await expect(page.getByRole('dialog', { name: 'Luna', exact: true })).toBeVisible();
    await page.getByRole('dialog', {name:'Luna',exact:true}).getByRole('button', { name: /^Close (Luna|sheet)$/ }).click();
    await expect(page.getByRole('dialog', { name: 'Luna', exact: true })).toHaveCount(0);
    await expect(launcher).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('sheet')).not.toBe('assistant');
    const closed = new URL(page.url());
    expect(closed.pathname).toBe(original.pathname);
    for (const key of ['tab', 'destination', 'homeView', 'record']) expect(closed.searchParams.get(key)).toBe(original.searchParams.get(key));
  }
  expect(errors).toEqual([]);
});

test('opening Luna does not discard a Homeguard form draft', async ({ page }) => {
  await page.goto(`${expanded}&tab=home&destination=tests&homeView=new`);
  await page.getByLabel('Test label (required)').fill('My retained draft');
  await page.getByRole('button', { name: /^(Ask|Open) Luna$/ }).click();
  await page.getByRole('dialog', {name:'Luna',exact:true}).getByRole('button', { name: 'Close sheet', exact:true }).click();
  await expect(page.getByLabel('Test label (required)')).toHaveValue('My retained draft');
});
