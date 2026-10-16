import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {emptyWeekMeta} from '../../lib/frontend/week-preview';

test('preparation and automatic repeat choices disclose their visit-only scope',async({page})=>{
  let writes=0;
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const action={id:'care-task-1',key:'home:care-task-1',title:'Review the filter instructions',date,state:'saved',revision:1,origin:'Home care',reason:'Follow up on the saved household concern.'};
  const network=await mockProduction(page,{'/api/frontend/actions':async route=>{
    if(route.request().method()!=='GET'){writes++;await route.abort();return;}
    await jsonRoute(route,{actions:[action],metas:{[action.key]:{...emptyWeekMeta,recurrence:'weekly'}},unresolvedOperations:[]});
  }});
  await page.goto('/app');
  await page.getByRole('button',{name:/^Get ready/}).click();
  const hub=page.locator('#homepage-hub');
  await expect(hub).toContainText('These choices are kept for this visit and clear when you reload.');
  await hub.getByRole('checkbox').first().check();
  await hub.getByRole('button',{name:'Save preparation checks',exact:true}).click();
  await expect(hub.getByRole('status')).toContainText('Preparation checks kept for this visit.');
  await hub.getByRole('button',{name:'Done',exact:true}).click();
  await page.locator('.mw-automation-tools > summary').click();
  await page.getByRole('button',{name:'Repeating plans',exact:true}).click();
  await hub.getByLabel('Request automatic next occurrences',{exact:true}).check();
  await hub.getByRole('button',{name:'Save repeat preferences',exact:true}).click();
  await expect(hub.getByRole('status')).toContainText('Repeat preferences kept for this visit.');
  await expect(hub.getByRole('status')).toContainText('Automatic scheduling is not connected.');
  expect(writes).toBe(0);
  await page.reload();
  await page.getByRole('button',{name:/^Get ready/}).click();
  await expect(hub.getByRole('checkbox').first()).not.toBeChecked();
  expect(writes).toBe(0);
  expect(network.blocked).toEqual([]);
});
