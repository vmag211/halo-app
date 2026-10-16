import {test,expect} from '@playwright/test';

test.skip(process.env.HALO_HOSTED_REVIEW_TEST!=='1','Static hosted-review export only.');
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)&&!u.pathname.startsWith('/api/')?route.continue():route.abort();});
});

for(const path of ['/app','/tools'])test(`${path} opens directly and keeps primary navigation short`,async({page})=>{
  const response=await page.goto(path);expect(response?.status()).toBe(200);
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await expect(nav.getByRole('link',{name:'My Week',exact:true})).toHaveAttribute('aria-current','page');
  expect(new URL(page.url()).pathname.replace(/\/$/,'')).toBe(path);
  expect(new URL(page.url()).search).toBe('');
  await expect(page.locator('.halo-f-review-tools')).toHaveCount(path==='/tools'?1:0);
  for(const name of ['Today','Homeguard','Explore','My Week']){
    await nav.getByRole('link',{name,exact:true}).click();
    await expect(nav.getByRole('link',{name,exact:true})).toHaveAttribute('aria-current','page');
    expect(new URL(page.url()).pathname.replace(/\/$/,'')).toBe(path);
    await expect(page.locator('.halo-f-review-tools')).toHaveCount(path==='/tools'?1:0);
  }
  await page.reload();await expect(nav.getByRole('link',{name:'My Week',exact:true})).toHaveAttribute('aria-current','page');
  await page.goto(`${path}/`);await expect(nav.getByRole('link',{name:'My Week',exact:true})).toHaveAttribute('aria-current','page');
  await expect(page.locator('.halo-f-review-tools')).toHaveCount(path==='/tools'?1:0);
});

test('short entry and legacy specialist routes share the same in-memory tasks',async({page})=>{
  await page.goto('/app?motion=reduce');await page.getByRole('button',{name:'Add task',exact:true}).click();
  const editor=page.locator('#week-task-detail');await editor.getByLabel('Task title',{exact:true}).fill('Keep my project follow-up');await editor.getByRole('button',{name:'Save task',exact:true}).click();
  const nav=page.getByRole('navigation',{name:'Main navigation'});await nav.getByRole('link',{name:'Today',exact:true}).click();
  await page.getByRole('link',{name:/^Air, .*Open factor page\.$/}).click();await expect(page).toHaveURL(/\/factor\/air/);
  await nav.getByRole('link',{name:'My Week',exact:true}).click();await expect(page.locator('.mw-agenda')).toContainText('Keep my project follow-up');
});
