import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {emptyWeekMeta} from '../../lib/frontend/week-preview';
import {reminderScheduleSignature,type ReminderState} from '../../lib/frontend/week-reminders';
import type {PreviewAction} from '../../lib/frontend/expanded-preview';

const action:PreviewAction={id:'reminder-task',key:'personal:reminder-task',title:'Review the water result',date:'2026-11-12',state:'saved',revision:3,origin:'Personal',reason:'Chosen follow-up'};
const meta={...emptyWeekMeta,reminder:true};
const evidence=(status:ReminderState['status']):ReminderState=>({actionRevision:3,scheduleSignature:reminderScheduleSignature(action,meta),status,updatedAt:'2026-10-16T16:00:00Z',...(status==='scheduled'?{scheduledFor:'2026-11-12T14:00:00Z'}:{}),...(status==='delivered'?{deliveredAt:'2026-10-16T15:00:00Z'}:{}),channel:'push'});

for(const [status,label] of [['pending','Pending'],['registered','Registered'],['scheduled','Scheduled'],['delivered','Delivered'],['failed','Delivery failed'],['cancelled','Cancelled'],['paused','Paused'],['unknown','Status unknown']] as const)test(`reminder manager shows canonical ${status}, not simulated success`,async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,{actions:[action],metas:{[action.key]:meta},reminderStates:{[action.id]:evidence(status)},unresolvedOperations:[]})});
 await page.goto('/app/plan/reminders');
 const hub=page.locator('#homepage-hub');
 await expect(hub).toBeVisible();
 await expect(hub.locator('.mw-reminder-badge')).toHaveText(label);
 await expect(hub).toContainText('push');
 if(status==='scheduled')await expect(hub).toContainText('does not guarantee delivery');
 if(status==='delivered')await expect(hub).toContainText('does not mean it was read');
 await hub.getByRole('button',{name:/^Review the water result/}).click();
 await expect(page.locator('#week-task-detail').getByLabel('Task title',{exact:true})).toHaveValue(action.title);
 expect(network.blocked).toEqual([]);
});

test('stale reminder status becomes unknown until a refreshed exact schedule is returned',async({page})=>{
 let refresh=false;let writes=0;
 await mockProduction(page,{'/api/frontend/actions':async route=>{
  if(route.request().method()!=='GET'){writes++;await route.abort();return;}
  await jsonRoute(route,{actions:[action],metas:{[action.key]:meta},reminderStates:{[action.id]:{...evidence('scheduled'),actionRevision:refresh?3:2}},unresolvedOperations:[]});
 }});
 await page.goto('/app');
 await page.locator('.mw-automation-tools > summary').click();
 await page.getByRole('button',{name:/^Reminders/}).click();
 const hub=page.locator('#homepage-hub');
 await expect(hub.locator('.mw-reminder-badge')).toHaveText('Needs sync');
 refresh=true;
 await hub.getByRole('button',{name:'Refresh reminder status',exact:true}).click();
 await expect(hub.locator('.mw-reminder-badge')).toHaveText('Scheduled');
 expect(writes).toBe(0);
});

test('old backend snapshots retain the request but cannot claim scheduling or delivery',async({page})=>{
 await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,{actions:[action],metas:{[action.key]:meta},unresolvedOperations:[]})});
 await page.goto('/app?destination=reminders');
 const hub=page.locator('#homepage-hub');
 await expect(hub.locator('.mw-reminder-badge')).toHaveText('Requested');
 await expect(hub).toContainText('Scheduling and delivery are not confirmed.');
 await hub.getByRole('button',{name:/^Review the water result/}).click();
 const detail=page.locator('#week-task-detail');
 await detail.getByText('Time, repeat & preparation',{exact:true}).click();
 await expect(detail.locator('.mw-reminder-evidence')).toContainText('Scheduling and delivery are not confirmed.');
});
