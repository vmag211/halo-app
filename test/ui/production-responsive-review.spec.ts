import {expect,test} from '@playwright/test';
import {mockProduction,settingsSnapshot} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

for(const width of [320,360,375,390,414,430,768,1024,1280,1440,1920])test(`primary journeys and semantic routes at ${width}px`,async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));const network=await mockProduction(page);
 await page.setViewportSize({width,height:900});await page.goto('/app');
 await expect(page.locator('.halo-f-header h1')).toHaveText('My Week');
 const nav=page.getByRole('navigation',{name:width>=1024?'Desktop main navigation':'Main navigation',exact:true});await expect(nav).toBeVisible();
 for(const [label,path] of [['Today','/app/today'],['Homeguard','/app/homeguard'],['Explore','/app/explore'],['My Week','/app']]){
  await nav.getByRole('link',{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(`${path}$`));await expect(page.locator('.halo-f-header h1')).toHaveText(label);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
 }
 await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task title').fill('A useful task with a longer title for checking the layout');
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();const box=await dialog.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(-1);expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);expect(box!.height).toBeLessThanOrEqual(900);
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await expect(page).toHaveURL(/\/app\/settings$/);await expect(page.locator('.halo-f-header h1')).toHaveText('Settings');
 expect(network.blocked).toEqual([]);expect(errors).toEqual([]);
});

test('semantic detail links retain their destination through reload and browser history',async({page})=>{
 const network=await mockProduction(page);await page.goto('/app/homeguard/tests');await expect(page.getByRole('heading',{name:'Home tests & reports',exact:true})).toBeVisible();
 await page.reload();await expect(page.getByRole('heading',{name:'Home tests & reports',exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Explore',exact:true}).click();await expect(page).toHaveURL(/\/app\/explore$/);
 await page.goBack();await expect(page).toHaveURL(/\/app\/homeguard\/tests$/);await expect(page.getByRole('heading',{name:'Home tests & reports',exact:true})).toBeVisible();
 await page.goForward();await expect(page.locator('.halo-f-header h1')).toHaveText('Explore');expect(network.blocked).toEqual([]);
});

test('desktop sidebar collapses without losing navigation or the current screen',async({page})=>{
 await mockProduction(page);await page.setViewportSize({width:1440,height:900});await page.goto('/app');
 await page.getByRole('button',{name:'Collapse navigation',exact:true}).click();await expect(page.locator('.halo-app-sidebar')).toHaveAttribute('data-collapsed','true');
 await page.getByRole('navigation',{name:'Desktop main navigation'}).getByRole('link',{name:'Homeguard',exact:true}).click();await expect(page.locator('.halo-app-sidebar')).toHaveAttribute('data-collapsed','true');
 await page.getByRole('button',{name:'Expand navigation',exact:true}).click();await expect(page.locator('.halo-app-sidebar')).toHaveAttribute('data-collapsed','false');
});

test('public landing and invalid app routes do not create an account or read private data',async({page})=>{
 const network=await mockProduction(page);await page.goto('/');await expect(page.getByRole('heading',{level:1})).toContainText('Understand your surroundings');expect(network.requests).toEqual([]);
 await page.goto('/app/not-a-feature');await expect(page.getByTestId('production-product')).toHaveCount(0);expect(network.requests).toEqual([]);
});

for(const appearance of ['dark','light']as const)for(const width of [375,768,1440])test(`visual review ${appearance} at ${width}px`,async({page})=>{
 await mockProduction(page,{'/api/settings':route=>jsonRoute(route,{...settingsSnapshot,display:{...settingsSnapshot.display,appearance}})});await page.setViewportSize({width,height:950});
 for(const route of ['','/today','/homeguard','/explore','/settings']){
  await page.goto(`/app${route}`);await expect(page.getByTestId('production-product')).toBeVisible();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode',appearance);await page.evaluate(()=>document.fonts.ready);
  if(route==='/explore'){
   const map=page.locator('.ex-mini-map-canvas');
   await expect(map).toHaveAttribute('data-map-preview-state','ready');
   await expect(map.locator('.halo-map-atlas')).toHaveAttribute('data-context','ready');
   await expect(map.locator('.halo-map-atlas')).toHaveAttribute('data-fonts','ready');
   await expect.poll(()=>map.evaluate(element=>{const canvas=element.querySelector('canvas')!,box=element.getBoundingClientRect(),drawn=canvas.getBoundingClientRect(),ratio=Math.min(devicePixelRatio,2);return box.width>0&&box.height>0&&canvas.width===Math.round(box.width*ratio)&&canvas.height===Math.round(box.height*ratio)&&drawn.width===box.width&&drawn.height===box.height;})).toBe(true);
  }
  await page.screenshot({path:`test-results-production-review/oct15/${appearance}-${width}-${route.slice(1)||'week'}.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);
 }
});

test('large text and short landscape keep navigation and task editing reachable',async({page})=>{
 await mockProduction(page,{'/api/settings':route=>jsonRoute(route,{...settingsSnapshot,display:{...settingsSnapshot.display,scale:'150'}})});
 for(const size of [{width:320,height:800},{width:844,height:390}]){
  await page.setViewportSize(size);await page.goto('/app');await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task title').fill('Keep the editor usable');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width+1);
 }
});

test('narrow large-text navigation keeps all labels readable without overlap',async({page})=>{
 await mockProduction(page,{'/api/settings':route=>jsonRoute(route,{...settingsSnapshot,display:{...settingsSnapshot.display,scale:'150'}})});
 await page.setViewportSize({width:320,height:850});await page.goto('/app');
 const nav=page.getByRole('navigation',{name:'Main navigation',exact:true});
 for(const active of ['Today','Homeguard','Explore','My Week']){
  await nav.getByRole('link',{name:active,exact:true}).click();
  await expect(nav.getByRole('link',{name:active,exact:true})).toHaveAttribute('aria-current','page');
  for(const label of ['My Week','Today','Homeguard','Explore']){
   const link=nav.getByRole('link',{name:label,exact:true}),target=(await link.boundingBox())!,text=(await link.locator('span').boundingBox())!;
   expect(text.x).toBeGreaterThanOrEqual(target.x);expect(text.x+text.width).toBeLessThanOrEqual(target.x+target.width);
   expect(target.width).toBeGreaterThanOrEqual(44);expect(target.height).toBeGreaterThanOrEqual(44);
   const size=await link.evaluate(element=>Number.parseFloat(getComputedStyle(element).fontSize));expect(size).toBeGreaterThanOrEqual(12);expect(size).toBeLessThanOrEqual(14);
  }
 }
});
