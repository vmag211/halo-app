import {test,expect,type Page} from '@playwright/test';
const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async({page})=>{await page.route('**/*',route=>{const u=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(u.hostname)&&!u.pathname.startsWith('/api/')?route.continue():route.abort();});});
async function connected(page:Page){await page.getByText('Expanded app review · Not approved',{exact:true}).click();await page.getByRole('button',{name:'Load connected activity examples',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Connected activity examples loaded'})).toBeVisible();await page.getByText('Expanded app review · Not approved',{exact:true}).click();}

for(const appearance of ['light','dark'])test(`calendar-first canvas, paired tools and activity photos in ${appearance}`,async({page},info)=>{
  await page.goto(`${root}&appearance=${appearance}`);await connected(page);
  await expect(page.locator('.mw-intro')).toHaveCount(0);
  await expect(page.locator('.mw-board-month')).toBeVisible();
  const paper=await page.locator('.mw-calendar').evaluate(el=>{const style=getComputedStyle(el);return [style.backgroundColor,style.backgroundImage];});
  const agendaColor=await page.locator('.mw-agenda').evaluate(el=>{const style=getComputedStyle(el);return [style.backgroundColor,style.backgroundImage];});
  // The redesign makes calendar and agenda one continuous planner surface.
  expect(paper).toEqual(agendaColor);
  await expect(page.getByRole('region',{name:'Your planner',exact:true}).getByRole('region',{name:'Calendar',exact:true})).toBeVisible();
  const calendar=(await page.locator('.mw-calendar').boundingBox())!,agenda=(await page.locator('.mw-agenda').boundingBox())!;
  expect(calendar.y).toBeLessThan(agenda.y);
  const tools=await page.locator('.mw-dashboard-tools a').all();const left=(await tools[0].boundingBox())!,right=(await tools[1].boundingBox())!;
  expect(Math.abs(left.y-right.y)).toBeLessThan(1);expect(right.x).toBeGreaterThan(left.x);
  await expect(page.locator('.mw-in-progress .mw-progress-photo').first()).toBeVisible();
  await page.evaluate(()=>window.scrollTo(0,document.querySelector('.halo-f-app')!.getBoundingClientRect().top+scrollY));
  await page.screenshot({path:info.outputPath(`canvas-${appearance}-375.png`)});
  await page.screenshot({path:info.outputPath(`canvas-${appearance}-full.png`),fullPage:true});
});

test('weekly effort uses supplied values and opens a day without rescheduling anything',async({page})=>{
  await page.goto(root);await connected(page);
  await page.locator('.mw-week-details > summary').click();await expect(page.locator('.mw-effort-open strong')).toHaveText('1h 45m planned');
  await page.getByRole('button',{name:/Plan effort/}).click();
  const sheet=page.locator('#week-effort');await expect(sheet).toContainText('Not tracked time or free calendar space.');
  await expect(sheet.locator('.mw-effort-days > button')).toHaveCount(7);
  await expect(sheet).not.toContainText('still need an estimate');
  await sheet.locator('.mw-effort-days > button').nth(5).click();
  await expect(sheet).not.toBeVisible();await expect(page.locator('.mw-days .selected strong')).toHaveText('17');
  await expect(page.locator('.mw-agenda')).toContainText('Community cleanup example');
  await page.getByRole('button',{name:/Plan effort/}).click();await page.goBack();await expect(sheet).not.toBeVisible();
  await expect(page.getByRole('button',{name:/Plan effort/})).toBeFocused();
});

test('activity key filters the same agenda and toggles back to all work',async({page})=>{
  await page.goto(root);await connected(page);
  await page.locator('.mw-week-details > summary').click();const button=page.getByRole('navigation',{name:'Filter agenda by activity'}).getByRole('button',{name:/^Projects,/});
  await button.click();await page.getByRole('button',{name:/^Filters/}).click();await expect(page.getByLabel('Show',{exact:true})).toHaveValue('Projects');await page.locator('#week-filters').getByRole('button',{name:'Show results',exact:true}).click();
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(1);await expect(page.locator('.mw-agenda')).toContainText('Draw a testable design');
  await button.click();await page.getByRole('button',{name:/^Filters/}).click();await expect(page.getByLabel('Show',{exact:true})).toHaveValue('Everything');await page.locator('#week-filters').getByRole('button',{name:'Show results',exact:true}).click();
});

test('saved idea scheduling prepares a review, cancels safely and revises only that task',async({page})=>{
  await page.goto(root);await page.getByRole('button',{name:'Add task',exact:true}).click();
  const detail=page.locator('#week-task-detail');await detail.getByLabel('Task title',{exact:true}).fill('An idea to schedule');
  await detail.getByRole('button',{name:'Save for later instead',exact:true}).click();await detail.getByRole('button',{name:'Save task',exact:true}).click();
  const later=page.getByRole('region',{name:'Saved for later'});await expect(later).toContainText('An idea to schedule');
  await later.getByRole('button',{name:'Schedule An idea to schedule',exact:true}).click();
  const move=page.locator('#week-reschedule');await expect(move.getByLabel('New date',{exact:true})).not.toHaveValue('');
  await page.goBack();await expect(move).not.toBeVisible();await expect(later).toContainText('An idea to schedule');
  await later.getByRole('button',{name:'Schedule An idea to schedule',exact:true}).click();await move.getByRole('button',{name:'Save new schedule',exact:true}).click();
  await expect(page.locator('.mw-agenda .mw-task').filter({hasText:'An idea to schedule'})).toHaveCount(1);
  await expect(later.locator('.mw-task').filter({hasText:'An idea to schedule'})).toHaveCount(0);
  await expect(page.locator('.mw-effort-open')).toContainText('Estimates not set');
});

test('calendar month, large text and high contrast fit the phone shell with real controls',async({page},info)=>{
  await page.setViewportSize({width:320,height:900});await page.goto(`${root}&appearance=dark&scale=150&contrast=true`);await connected(page);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:'Month',exact:true}).click();await expect(page.locator('.mw-days button')).toHaveCount(42);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath('canvas-high-contrast-month-320.png')});await page.locator('.mw-week-details > summary').click();
  await page.getByRole('button',{name:/Plan effort/}).click();
  await expect(page.locator('#week-effort')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
