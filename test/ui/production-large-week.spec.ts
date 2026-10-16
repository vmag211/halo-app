import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {emptyWeekMeta} from '../../lib/frontend/week-preview';

test('a 500-task account retains month navigation and exact search without losing records',async({page},info)=>{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const actions=Array.from({length:500},(_,index)=>({id:`load-${index}`,key:`manual:load-${index}`,title:`Household follow-up ${index}`,date,state:'saved',revision:1,origin:'My Week',reason:'User-entered follow-up.'}));
  const metas=Object.fromEntries(actions.map(action=>[action.key,{...emptyWeekMeta}]));
  const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,{actions,metas,unresolvedOperations:[]})});
  await page.addInitScript(()=>{
    const metrics=window as Window&{haloLayoutShift?:number};metrics.haloLayoutShift=0;
    new PerformanceObserver(list=>{for(const entry of list.getEntries()){const shift=entry as PerformanceEntry&{hadRecentInput:boolean;value:number};if(!shift.hadRecentInput)metrics.haloLayoutShift=(metrics.haloLayoutShift??0)+shift.value;}}).observe({type:'layout-shift',buffered:true});
  });
  await page.setViewportSize({width:1440,height:900});
  const start=Date.now();await page.goto('/app');
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(500);
  const loaded=Date.now();await page.getByRole('button',{name:'Month',exact:true}).click();
  await expect(page.locator('.mw-days button')).toHaveCount(42);
  await page.getByRole('button',{name:'Week',exact:true}).click();
  const searchStart=Date.now();await page.getByPlaceholder('Find a task or record').fill('Household follow-up 499');
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(1);
  const searchMs=Date.now()-searchStart;
  await page.locator('.mw-agenda .mw-task-open').click();
  await expect(page.getByLabel('Task title')).toHaveValue('Household follow-up 499');
  expect(network.blocked).toEqual([]);
  const cls=await page.evaluate(()=>(window as Window&{haloLayoutShift?:number}).haloLayoutShift??0);
  expect(loaded-start,'Local 500-task render budget').toBeLessThan(15000);
  expect(searchMs,'Local search interaction budget').toBeLessThan(2000);
  expect(cls,'Unexpected cumulative layout shift').toBeLessThan(.25);
  await info.attach('observed-local-timings',{body:JSON.stringify({taskCount:500,loadToVisibleMs:loaded-start,searchMs,cls,journeyMs:Date.now()-start,budgets:{loadMs:15000,searchMs:2000,cls:.25},note:'Local mocked-service regression budgets, not a physical-device or production performance claim.'}),contentType:'application/json'});
});
