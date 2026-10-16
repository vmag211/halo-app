import {test,expect,type Page} from '@playwright/test';

const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();
  });
});

async function addTask(page:Page,title:string){
  await page.getByRole('button',{name:'Add task',exact:true}).click();
  const sheet=page.locator('#week-task-detail');
  await sheet.getByLabel('Task title',{exact:true}).fill(title);
  await sheet.getByRole('button',{name:'Save task',exact:true}).click();
}

for(const width of [320,360,375,390,414,430,768,1024,1280,1440,1920]){
  test(`planner retains the task journey at ${width}px`,async({page},info)=>{
    await page.setViewportSize({width,height:900});
    await page.goto(root);
    await expect(page.getByRole('heading',{name:'Your day',exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    const planner=(await page.locator('.mw-dashboard-main').boundingBox())!;
    const support=(await page.getByRole('complementary',{name:'Week overview and tools'}).boundingBox())!;
    const workspace=(await page.locator('.mw-workspace').boundingBox())!;
    if(workspace.width>=760){
      expect(support.x).toBeGreaterThan(planner.x+planner.width);
      expect(Math.abs(support.y-planner.y)).toBeLessThan(2);
    }else{
      expect(support.y).toBeGreaterThanOrEqual(planner.y+planner.height-1);
    }
    await addTask(page,'Review the water test follow-up');
    await expect(page.locator('.mw-agenda')).toContainText('Review the water test follow-up');
    await page.getByRole('button',{name:'Complete Review the water test follow-up',exact:true}).click();
    await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(0);
    await page.getByRole('button',{name:/^Filters/}).click();
    const filters=page.locator('#week-filters');
    await filters.getByLabel('Include completed items',{exact:true}).check();
    await filters.getByRole('button',{name:'Show results',exact:true}).click();
    await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(1);
    await page.getByRole('button',{name:'Reopen Review the water test follow-up',exact:true}).click();
    await page.locator('.mw-task-open').filter({hasText:'Review the water test follow-up'}).click();
    await expect(page.locator('#week-task-detail').getByLabel('Status',{exact:true})).toHaveValue('saved');
    await page.locator('#week-task-detail').getByRole('button',{name:'Cancel',exact:true}).click();
    if(width===375||width===1920)await page.screenshot({path:info.outputPath(`week-task-journey-${width}.png`),fullPage:true});
    await page.getByRole('button',{name:'Month',exact:true}).click();
    await expect(page.locator('.mw-days button')).toHaveCount(42);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  });
}

test('filters retain state and restore their opener with browser Back',async({page})=>{
  await page.goto(root);
  const opener=page.getByRole('button',{name:/^Filters/});
  await opener.click();
  await page.locator('#week-filters').getByLabel('Show',{exact:true}).selectOption('Home');
  await page.goBack();
  await expect(page.locator('#week-filters')).not.toBeVisible();
  await expect(opener).toBeFocused();
  await expect(opener).toHaveAccessibleName('Filters, 1 active');
  await opener.click();
  await expect(page.locator('#week-filters').getByLabel('Show',{exact:true})).toHaveValue('Home');
  await page.locator('#week-filters').getByRole('button',{name:'Reset filters',exact:true}).click();
  await page.locator('#week-filters').getByRole('button',{name:'Show results',exact:true}).click();
  await expect(opener).toHaveAccessibleName('Filters');
});

test('one reminder manager retains requested tasks and exact schedule access',async({page})=>{
  await page.goto(root);
  await addTask(page,'Check the new radon result');
  await page.locator('.mw-task-open').filter({hasText:'Check the new radon result'}).click();
  const detail=page.locator('#week-task-detail');
  await detail.getByText('Time, repeat & preparation',{exact:true}).click();
  await detail.getByLabel('Request a reminder',{exact:true}).check();
  await detail.getByRole('button',{name:'Save task',exact:true}).click();
  await expect(page.locator('.mw-reminder-panel')).toHaveCount(0);
  await page.locator('.mw-automation-tools > summary').click();
  await page.getByRole('button',{name:/^Reminders/}).click();
  await expect(page.locator('#homepage-hub')).toContainText('1 requested task reminders');
  await expect(page.locator('#homepage-hub')).toContainText('Delivery not connected');
  await page.locator('#homepage-hub').getByRole('button',{name:/^Check the new radon result/}).click();
  await expect(detail.getByLabel('Task title',{exact:true})).toHaveValue('Check the new radon result');
});

test('long task titles and filter actions remain usable in short landscape',async({page})=>{
  await page.setViewportSize({width:768,height:360});
  await page.goto(root);
  const title='Review the household water test findings and choose the next follow-up with the utility before arranging another laboratory test for our kitchen drinking water';
  await addTask(page,title);
  await expect(page.locator('.mw-agenda')).toContainText(title);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.getByRole('button',{name:/^Filters/}).click();
  const sheet=page.locator('#week-filters');
  await sheet.getByLabel('Show',{exact:true}).selectOption('Personal');
  await sheet.getByRole('button',{name:'Show results',exact:true}).click();
  await expect(sheet).not.toBeVisible();
  await expect(page.locator('.mw-agenda')).toContainText(title);
});

for(const appearance of ['light','dark'])test(`calendar and filter sheet fit enlarged ${appearance} text`,async({page},info)=>{
  await page.setViewportSize({width:320,height:740});
  await page.goto(`${root}&appearance=${appearance}&scale=150`);
  await page.getByRole('button',{name:'Month',exact:true}).click();
  await page.getByRole('button',{name:/^Filters/}).click();
  await expect(page.locator('#week-filters').getByLabel('Show',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:info.outputPath(`week-filters-${appearance}-320.png`)});
  await page.goBack();
  await page.screenshot({path:info.outputPath(`week-overview-${appearance}-320.png`),fullPage:true});
});
