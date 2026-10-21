import {test,expect} from '@playwright/test';

const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();
  });
});

test('homepage leads with daily work and exposes retained calendar controls on demand',async({page})=>{
  await page.goto(root);
  await expect(page.getByRole('heading',{name:'Your day',exact:true})).toBeVisible();
  await expect(page.locator('.mw-board-totals')).not.toBeVisible();
  await expect(page.locator('.mw-next-panel')).toHaveCount(0);
  await expect(page.locator('.mw-shelf')).toHaveCount(0);
  await expect(page.locator('.mw-progress-empty')).toHaveCount(0);
  await expect(page.locator('.mw-day-empty')).toHaveText('No plans for this day.');
  const calendar=await page.locator('.mw-calendar').boundingBox(),agenda=await page.locator('.mw-agenda').boundingBox(),overview=await page.locator('.mw-overview').boundingBox();
  expect(calendar!.y).toBeLessThan(agenda!.y);expect(agenda!.y).toBeLessThan(overview!.y);
  // An empty week opens with starter ideas (bounded in my-week-starters.spec.ts); measure the planner once they are hidden.
  await page.getByRole('button',{name:'Hide these ideas',exact:true}).click();
  // The primary planning surface remains above the supporting overview stack.
  expect((await page.locator('.mw-dashboard-main').boundingBox())!.height).toBeLessThan(850);
  expect((await page.locator('.mw-workspace').boundingBox())!.height).toBeLessThan(1600);
  const summary=page.locator('.mw-week-details > summary');
  await summary.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.mw-board-totals')).toBeVisible();
  await page.getByRole('button',{name:/Plan effort/}).click();
  await expect(page.locator('#week-effort')).toBeVisible();await page.goBack();
  await expect(page.getByRole('button',{name:/Plan effort/})).toBeFocused();
  const options=page.locator('.mw-calendar-options > summary');
  await options.focus();await page.keyboard.press('Enter');
  await page.locator('.mw-calendar-prefs > summary').click();
  await page.getByLabel('Display timezone',{exact:true}).selectOption('UTC');
  await page.locator('.mw-rhythm > summary').click();
  await page.getByLabel('Show my action streak',{exact:true}).check();
  const nav=page.getByRole('navigation',{name:'Main navigation'});
  await nav.getByRole('link',{name:'Today',exact:true}).click();
  await nav.getByRole('link',{name:'My Week',exact:true}).click();
  await expect(page.locator('.mw-rhythm-title')).toContainText('0 days of follow-through');
  await page.locator('.mw-calendar-options > summary').click();
  await page.locator('.mw-calendar-prefs > summary').click();
  await expect(page.getByLabel('Display timezone',{exact:true})).toHaveValue('UTC');
});

test('an empty saved shelf appears only when a task is saved for later and keeps its canonical schedule flow',async({page})=>{
  await page.goto(root);
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  const detail=page.locator('#week-task-detail');
  await detail.getByLabel('Task title',{exact:true}).fill('Choose a planting site');
  await detail.getByRole('button',{name:'Save for later instead',exact:true}).click();
  await detail.getByRole('button',{name:'Save task',exact:true}).click();
  const later=page.getByRole('region',{name:'Saved for later',exact:true});
  await expect(later.locator('.mw-task')).toHaveCount(1);
  await later.getByRole('button',{name:'Schedule Choose a planting site',exact:true}).click();
  await page.locator('#week-reschedule').getByRole('button',{name:'Keep current schedule',exact:true}).click();
  await expect(later.locator('.mw-task')).toHaveCount(1);
  await later.getByRole('button',{name:'Schedule Choose a planting site',exact:true}).click();
  await page.locator('#week-reschedule').getByRole('button',{name:'Save new schedule',exact:true}).click();
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(1);
  await expect(page.locator('.mw-shelf')).toHaveCount(0);
});

for(const appearance of ['light','dark'])test(`refined homepage remains usable at phone width and enlarged ${appearance} text`,async({page},info)=>{
  for(const [width,scale]of [[390,100],[320,150]]){
    await page.setViewportSize({width,height:900});await page.goto(`${root}&appearance=${appearance}&scale=${scale}`);
    await expect(page.locator('.mw-board-month')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    expect(await page.locator('.mw-board-month').evaluate(el=>getComputedStyle(el).fontFamily)).not.toMatch(/fraunces|georgia/i);
    await page.screenshot({path:info.outputPath(`homepage-refined-${appearance}-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Month',exact:true}).click();
    await expect(page.locator('.mw-days button')).toHaveCount(42);
    await page.locator('.mw-calendar-options > summary').click();
    await page.locator('.mw-date-sources > summary').click();
    await page.getByLabel('Include dates from my records',{exact:true}).uncheck();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
});
