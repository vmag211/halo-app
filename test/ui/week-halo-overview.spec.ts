import {test,expect} from '@playwright/test';
const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async({page})=>{await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)&&!u.pathname.startsWith('/api/')?route.continue():route.abort();});});
for(const appearance of ['light','dark'])test(`compact overview inherits HALO styling in ${appearance}`,async({page},info)=>{
  await page.goto(`${root}&appearance=${appearance}`);
  const glance=page.getByRole('region',{name:'Your HALO overview'});await expect(glance).toBeVisible();
  await expect(glance.locator('.mw-mini-gauge strong')).toHaveText(['74','58']);
  const colors=await page.evaluate(()=>{const a=getComputedStyle(document.querySelector('.halo-f-app')!),b=getComputedStyle(document.querySelector('.mw-dashboard')!);return ['--halo-ink','--halo-primary','--halo-card','--halo-secondary'].map(k=>[a.getPropertyValue(k).trim(),b.getPropertyValue(k).trim()]);});
  for(const [app,dashboard]of colors)expect(dashboard).toBe(app);
  await expect(glance).toContainText('September 30, 2026');
  await expect(glance.locator('.mw-rhythm-days > span')).toHaveCount(7);
  await expect(page.locator('.mw-tool-art')).toHaveCount(2);
  await page.screenshot({path:info.outputPath(`halo-dashboard-${appearance}-375.png`),fullPage:true});
});
for(const [scenario,values]of [['no-data',['N/A','N/A']],['score-zero',['0','0']],['score-full',['100','100']],['partial',['74','58']]] as const)test(`overview preserves ${scenario} score semantics`,async({page})=>{
  await page.goto(`${root}&scenario=${scenario}`);await expect(page.locator('.mw-mini-gauge strong')).toHaveText([...values]);
  if(scenario==='partial')await expect(page.locator('.mw-score-glance small')).toHaveText(['Partial score','Partial score']);
  if(scenario==='no-data')await expect(page.locator('.mw-gauge-value')).toHaveCount(0);
});
test('score shortcuts open their existing overview and keep the selected calendar day',async({page})=>{
  await page.goto(root);await page.locator('.mw-days button').nth(3).click();const selected=await page.locator('.mw-days .selected').getAttribute('aria-label');
  await page.getByRole('link',{name:'Open Homeguard, 58 out of 100',exact:true}).click();await expect(page).toHaveURL(/tab=home/);await expect(page.getByRole('region',{name:'Homeguard overview',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'My Week',exact:true}).click();await expect(page.locator('.mw-days .selected')).toHaveAttribute('aria-label',selected!);
  await page.getByRole('link',{name:'Open Today, 74 out of 100',exact:true}).click();await expect(page).toHaveURL(/tab=today/);
});
test('action bar counts recorded completion and the optional streak can be hidden',async({page})=>{
  await page.goto(root);await page.getByRole('button',{name:'Add task',exact:true}).click();const form=page.locator('#week-task-detail');await form.getByLabel('Task title',{exact:true}).fill('My recorded action');await form.getByRole('button',{name:'Save task',exact:true}).click();
  await page.getByRole('button',{name:'Complete My recorded action',exact:true}).click();await page.getByRole('button',{name:'Show streak',exact:true}).click();
  await expect(page.locator('.mw-rhythm-title')).toContainText('1 day of follow-through');await expect(page.locator('.mw-rhythm-days [data-complete="true"]')).toHaveCount(1);
  await page.getByRole('button',{name:'Hide streak',exact:true}).click();await expect(page.locator('.mw-rhythm-title')).toContainText('This week’s follow-through');await expect(page.locator('.mw-rhythm-days [data-complete="true"]')).toHaveCount(1);
  await expect(page.locator('.mw-mini-gauge strong')).toHaveText(['74','58']);
});
test('overview and month calendar fit enlarged phone text',async({page},info)=>{
  await page.setViewportSize({width:320,height:900});await page.goto(`${root}&appearance=dark&scale=150&contrast=true`);await expect(page.locator('.mw-score-pair')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Month',exact:true}).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('halo-dashboard-320-large.png'),fullPage:true});
});
