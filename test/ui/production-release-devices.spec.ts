import {expect,test,type Page} from '@playwright/test';
import {homeId,mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import type {WeekEntry} from '../../components/expanded/WeekJournal';

/* Regressions from the 2026-10-25 device, keyboard and accessibility release pass. */
const today='2026-10-15';
async function fixedDate(page:Page){await page.clock.setFixedTime(new Date(`${today}T16:00:00Z`));}
const saved=(note:string):WeekEntry=>({id:`journal:${homeId}:${today}:household`,title:'Check-in',revision:4,date:today,band:'household',fine:true,symptoms:[],severity:'',illness:false,note,recalled:false,homeContextId:homeId});
const box=(page:Page,selector:string)=>page.locator(selector).evaluateAll(nodes=>nodes.filter(n=>(n as HTMLElement).offsetParent!==null).map(n=>{const r=n.getBoundingClientRect();return {w:Math.round(r.width),h:Math.round(r.height),name:n.getAttribute('aria-label')||n.textContent?.trim()};}));

test('returning to the Journal on a day already logged opens that check-in for update, not a colliding new one',async({page})=>{
 await fixedDate(page);let current=saved('Morning note');const commands:{expectedRevision:number;record:WeekEntry}[]=[];
 const network=await mockProduction(page,{
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='weekJournal'?[current]:[],revision:1,availability:'ready',complete:true,pendingOperations:[]}),
  '/api/frontend/workspace/commands':async route=>{const command=route.request().postDataJSON();commands.push(command);current={...command.record,revision:5};await jsonRoute(route,{operationId:command.operationId,status:'succeeded',changes:{weekJournal:[current]},revisions:{weekJournal:2}});},
 });
 await page.goto('/app/journal');
 await expect(page.getByRole('button',{name:'Update check-in',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Felt fine',exact:true}).first()).toHaveAttribute('aria-pressed','true');
 await expect(page.getByLabel('Private note (optional)')).toHaveValue('Morning note');
 await page.getByLabel('Private note (optional)').fill('Evening note');await page.getByRole('button',{name:'Update check-in',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Check-in saved.'})).toBeVisible();
 expect(commands).toHaveLength(1);expect(commands[0].expectedRevision).toBe(4);expect(commands[0].record.id).toBe(saved('').id);expect(commands[0].record.note).toBe('Evening note');
 expect(network.blocked).toEqual([]);
});

test('a Journal day with no check-in still starts a new one',async({page})=>{
 await fixedDate(page);const network=await mockProduction(page);
 await page.goto('/app/journal');
 await expect(page.getByRole('button',{name:'Save check-in',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Felt fine',exact:true}).first()).toHaveAttribute('aria-pressed','false');
 expect(network.blocked).toEqual([]);
});

test('the map has a skip link that moves focus to the map content',async({page})=>{
 const network=await mockProduction(page);await page.setViewportSize({width:1280,height:800});
 await page.goto('/map?access=owned&layer=water');await expect(page.getByRole('radiogroup',{name:'Map layer'})).toBeVisible();
 await page.keyboard.press('Tab');
 const skip=page.getByRole('link',{name:'Skip to content'});await expect(skip).toBeFocused();
 const r=await skip.boundingBox();expect(r!.y).toBeGreaterThanOrEqual(0);
 await page.keyboard.press('Enter');await expect(page.locator('#halo-map-main')).toBeFocused();
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>!!document.activeElement?.closest('#halo-map-main'))).toBe(true);
 expect(network.blocked).toEqual([]);
});

test.describe('phone touch targets',()=>{
 test.use({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 test('starter ideas, date picker days, Journal view and map presentation controls are at least 44px',async({page})=>{
  await fixedDate(page);const network=await mockProduction(page,{'/api/evidence':route=>jsonRoute(route,{rows:[],complete:true})});
  await page.goto('/app');await expect(page.getByRole('region',{name:'Ideas to start your week'})).toBeVisible();
  for(const target of await box(page,'.mw-starter-add,.mw-starter-dismiss'))expect(Math.min(target.w,target.h),target.name??'').toBeGreaterThanOrEqual(44);
  await page.getByRole('button',{name:'Add task'}).first().click();
  await page.getByRole('dialog',{name:'Add a task'}).getByRole('button',{name:'Choose date'}).click();
  const days=await box(page,'.halo-date-popover .halo-date-row button');expect(days.length).toBeGreaterThan(27);
  for(const day of days)expect(Math.min(day.w,day.h),day.name??'').toBeGreaterThanOrEqual(44);
  // Days outside the month stay readable: no fading opacity on secondary text.
  const outside=page.locator('.halo-date-popover button[data-outside="true"]').first();
  await expect(outside).toHaveCSS('opacity','1');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.goto('/app/plan/patterns');
  for(const target of await box(page,'.we-segment button'))expect(Math.min(target.w,target.h),target.name??'').toBeGreaterThanOrEqual(44);
  await page.goto('/map?access=owned&layer=water');await expect(page.getByRole('group',{name:'Map presentation'})).toBeVisible();
  for(const target of await box(page,'.halo-map-presentation button'))expect(Math.min(target.w,target.h),target.name??'').toBeGreaterThanOrEqual(44);
  expect(network.blocked).toEqual([]);
 });
});

test('the Luna sheet keeps one header landmark and its answer headings follow the sheet heading',async({page})=>{
 const conversation={id:'grounded',revision:1,messages:[{id:'m',role:'assistant',text:'Here is the distinction.',sources:[{title:'AirNow source',url:'https://www.airnow.gov/'}],evidence:[{kind:'fact',text:'The monitor reports outdoor air.',sourceIndexes:[0]}]}],pendingRequest:null,unresolvedOperations:{}};
 const network=await mockProduction(page,{'/api/luna/conversations':route=>jsonRoute(route,conversation)});
 await page.goto('/app');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Luna'});await expect(dialog.getByRole('region',{name:'From the source',exact:true})).toBeVisible();
 expect(await dialog.getByRole('banner').count()).toBeLessThanOrEqual(1);
 await expect(dialog.getByRole('contentinfo')).toHaveCount(0);
 await expect(dialog.getByRole('heading',{name:'From the source',level:3})).toBeVisible();
 expect(network.blocked).toEqual([]);
});

test('the animated factor number is exposed with a permitted role',async({page})=>{
 const network=await mockProduction(page,{'/api/daily-score':route=>jsonRoute(route,{air:{aqi:38,severity:'good',source:'open-meteo',is_measured:false,dominant_pollutant:'PM2.5'},uv:{index:2,severity:'good',peak_window:null},pollen:null,mold:null,score:{display_score:81,severity:'good',is_partial:true,missing_inputs:['pollen','mold'],included_inputs:['air','uv'],inputs:{air:15,uv:16,pollen:null,mold:null},factor_scores:{air:86,uv:97}},retrieved_at:'2026-10-13T14:00:00Z',cached:false})});await page.goto('/factors/air');
 const number=page.locator('.halo-number').first();await expect(number).toBeVisible();
 await expect(number).toHaveAttribute('role','img');await expect(number).toHaveAttribute('aria-label',/^\d+$/);
 expect(network.blocked).toEqual([]);
});
