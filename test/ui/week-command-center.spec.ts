import {test,expect} from '@playwright/test';
const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
test.beforeEach(async({page})=>{
 await page.route('**/*',route=>{const url=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});
});
for(const appearance of ['light','dark'])for(const width of [375,1280])test(`command center has distinct empty and working ${appearance} compositions at ${width}`,async({page},info)=>{
 await page.setViewportSize({width,height:900});
 await page.goto(`${root}&appearance=${appearance}`);
 const planner=page.getByRole('region',{name:'Your planner',exact:true});
 await expect(planner).toBeVisible();
 await expect(planner.getByRole('region',{name:'Calendar',exact:true})).toBeVisible();
 await expect(planner.getByRole('region',{name:'Agenda',exact:true})).toBeVisible();
 await expect(page.locator('.mw-command-copy .mw-add')).toBeVisible();
 const art=(await page.locator('.mw-ambience').boundingBox())!,workspace=(await page.locator('.mw-workspace').boundingBox())!;
 expect(art.width).toBeLessThan(workspace.width*.6);
 expect(art.height).toBeLessThanOrEqual(133);
 await expect(page.getByRole('button',{name:'Next landscape',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 await page.screenshot({path:info.outputPath(`week-empty-${appearance}-${width}.png`),fullPage:true});
 await page.getByRole('button',{name:'Add task',exact:true}).click();
 const editor=page.locator('#week-task-detail');
 await editor.getByLabel('Task title',{exact:true}).fill('Review the household water test');
 await editor.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(planner.getByRole('region',{name:'Agenda',exact:true})).toContainText('Review the household water test');
 await expect(page.locator('.mw-next-action')).toContainText('Review the household water test');
 await page.screenshot({path:info.outputPath(`week-working-${appearance}-${width}.png`),fullPage:true});
});
