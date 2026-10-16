import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {emptyWeekMeta} from '../../lib/frontend/week-preview';

test('a 500-task account retains month navigation and exact search without losing records',async({page},info)=>{
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const actions=Array.from({length:500},(_,index)=>({id:`load-${index}`,key:`manual:load-${index}`,title:`Household follow-up ${index}`,date,state:'saved',revision:1,origin:'My Week',reason:'User-entered follow-up.'}));
  const metas=Object.fromEntries(actions.map(action=>[action.key,{...emptyWeekMeta}]));
  const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,{actions,metas,unresolvedOperations:[]})});
  await page.setViewportSize({width:1440,height:900});
  const start=Date.now();await page.goto('/app');
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(500);
  const loaded=Date.now();await page.getByRole('button',{name:'Month',exact:true}).click();
  await expect(page.locator('.mw-days button')).toHaveCount(42);
  await page.getByRole('button',{name:'Week',exact:true}).click();
  await page.getByPlaceholder('Find a task or record').fill('Household follow-up 499');
  await expect(page.locator('.mw-agenda .mw-task')).toHaveCount(1);
  await page.locator('.mw-agenda .mw-task-open').click();
  await expect(page.getByLabel('Task title')).toHaveValue('Household follow-up 499');
  expect(network.blocked).toEqual([]);
  await info.attach('observed-local-timings',{body:JSON.stringify({taskCount:500,loadToVisibleMs:loaded-start,journeyMs:Date.now()-start,note:'Single local mocked-service run, not a device or production benchmark.'}),contentType:'application/json'});
});
