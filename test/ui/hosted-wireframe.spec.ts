import { test, expect } from '@playwright/test';

test.skip(process.env.HALO_HOSTED_REVIEW_TEST !== '1', 'Static hosted-review export only.');

test('static desktop settings switches panels without losing drafts or its return destination', async ({page}) => {
  await page.setViewportSize({width:1280,height:900});
  await page.goto('/foundation/preview/expanded/?tab=settings&appearance=dark&motion=reduce');
  await page.locator('[data-setting-panel="display"]').click();
  await page.getByRole('radio',{name:'Light',exact:true}).check();
  await page.getByRole('navigation',{name:'Settings sections',exact:true}).getByRole('button',{name:'Home & household',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Home & household',exact:true})).toBeVisible();
  await expect(page).toHaveURL(/open=home/);
  await page.getByRole('button',{name:'All settings',exact:true}).click();
  await page.locator('[data-setting-panel="display"]').click();
  await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
});
test('hosted entry retains review settings and opens the shared four-tab layout', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
      unexpected.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  await page.goto('/?tab=home&appearance=light&motion=reduce&scale=115&time=day');
  await expect(page).toHaveURL(/\/foundation\/preview\/expanded\//);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveText(['My Week', 'Today', 'Homeguard', 'Explore']);
  await expect(nav.getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('.halo-f-review-tools')).toHaveCount(0);
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode', 'light');
  expect(new URL(page.url()).searchParams.get('scale')).toBe('115');
  for(const name of ['Today','Explore','My Week']){
    await nav.getByRole('link',{name,exact:true}).click();
    await expect(nav.getByRole('link',{name,exact:true})).toHaveAttribute('aria-current','page');
    await expect(page.locator('.halo-f-review-tools')).toHaveCount(0);
  }
  await page.goto('/foundation/preview/expanded/?edition=legacy&motion=reduce');
  await expect(nav.getByRole('link')).toHaveText(['My Week', 'Today', 'Homeguard', 'Explore']);
  expect(unexpected).toEqual([]);
});

test('developer link exposes review tools and retains access through app navigation',async({page})=>{
  await page.goto('/foundation/preview/expanded/?review=tools&tab=home&motion=reduce');
  const tools=page.locator('.halo-f-review-tools');
  await tools.getByText('Expanded app review · Not approved',{exact:true}).click();
  await expect(tools).toContainText('fictional environmental records');
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Explore',exact:true}).click();
  await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Explore',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page).toHaveURL(/review=tools/);
  await expect(tools).toBeVisible();
  if(await tools.getAttribute('open')===null)await tools.locator(':scope > summary').click();
  await tools.getByRole('combobox',{name:'Explore workspace state',exact:true}).selectOption('error');
  await expect(page.getByRole('heading',{name:'Explore could not load',exact:true})).toBeVisible();
  await tools.getByRole('combobox',{name:'Explore workspace state',exact:true}).selectOption('ready');
  await expect(page.getByRole('heading',{name:'Get involved',exact:true})).toBeVisible();
});

test('all household detail exports load without contacting a backend', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('pageerror', error => unexpected.push(error.message));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1' || url.pathname.startsWith('/api/')) {
      unexpected.push(url.pathname); return route.abort();
    }
    return route.continue();
  });
  for (const member of ['toddler', 'child', 'teen', 'adult', 'senior', 'pregnant', 'respiratory']) {
    const response = await page.goto(`/foundation/preview/household/${member}/?edition=expanded&motion=reduce`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Homeguard' })).toHaveAttribute('aria-current', 'page');
  }
  expect(unexpected).toEqual([]);
});
