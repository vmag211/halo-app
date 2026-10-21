import {expect,test,type Page} from '@playwright/test';
import {homeId,mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import type {WeekEntry} from '../../components/expanded/WeekJournal';

const today='2026-10-15';
const yesterday='2026-10-14';
const checkin=(id:string,context=homeId,recalled=false):WeekEntry=>({id,title:'Household check-in',revision:4,date:yesterday,band:'household',fine:true,symptoms:[],severity:'',illness:false,note:'Original private note',recalled,homeContextId:context});
async function fixedDate(page:Page){await page.clock.setFixedTime(new Date(`${today}T16:00:00Z`));}

for(const recalled of [false,true])test(`editing a saved ${recalled?'recalled':'same-day'} check-in preserves its original logging basis`,async({page})=>{
 await fixedDate(page);let current=checkin('journal-original',homeId,recalled),writes=0;
 const network=await mockProduction(page,{
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='weekJournal'?[current]:[],revision:1,complete:true,pendingOperations:[]}),
  '/api/frontend/workspace/commands':async route=>{const command=route.request().postDataJSON();writes++;expect(command.collection).toBe('weekJournal');expect(command.expectedRevision).toBe(4);expect(command.record.recalled).toBe(recalled);expect(command.record.date).toBe(yesterday);current={...command.record,revision:5};await jsonRoute(route,{operationId:command.operationId,status:'succeeded',changes:{weekJournal:[current]},revisions:{weekJournal:2}});},
 });
 await page.goto('/plan?destination=journal');await page.locator('.mw-journal .mw-task-open').click();
 await expect(page.locator('.mw-form')).toContainText(recalled?'Remembered entry, not a same-day observation.':'Same-day entry.');
 await page.getByLabel('Private note (optional)').fill('Corrected private note');await page.getByRole('button',{name:'Update check-in',exact:true}).click();
 await expect(page.locator('.mw-form')).toContainText('Check-in saved.');expect(writes).toBe(1);expect(current.note).toBe('Corrected private note');
 await page.reload();await expect(page.locator('.mw-journal .mw-task-open')).toContainText(recalled?'Recalled':'Same day');expect(network.blocked).toEqual([]);
});

test('season history requests the selected season instead of the current twelve-week window',async({page})=>{
 await fixedDate(page);const ranges:{from:string|null;to:string|null}[]=[];
 const network=await mockProduction(page,{'/api/evidence':async(route,url)=>{ranges.push({from:url.searchParams.get('from'),to:url.searchParams.get('to')});await jsonRoute(route,{rows:[],comparison:{context:homeId,basis:'daily maximum',version:'history-v1'},complete:true});}});
 await page.goto('/plan?destination=recap');await expect(page.getByRole('combobox',{name:'Season',exact:true})).toBeVisible();
 await page.getByRole('combobox',{name:'Season',exact:true}).selectOption('Summer');await page.getByRole('combobox',{name:'Year',exact:true}).selectOption('2025');
 await expect.poll(()=>ranges.at(-1)).toEqual({from:'2025-06-01',to:'2025-08-31'});await expect(page.locator('.we-season')).toContainText('2025-06-01 to 2025-08-31');
 await page.getByRole('combobox',{name:'Season',exact:true}).selectOption('Winter');await expect.poll(()=>ranges.at(-1)).toEqual({from:'2025-12-01',to:'2026-02-28'});expect(network.blocked).toEqual([]);
});

test('Patterns exports the displayed home context and excludes private notes',async({page})=>{
 await fixedDate(page);const rows=[checkin('current-checkin'),checkin('prior-home-checkin','another-home')];
 const network=await mockProduction(page,{
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='weekJournal'?rows:[],revision:1,complete:true,pendingOperations:[]}),
  '/api/evidence':route=>jsonRoute(route,{rows:[{date:yesterday,factor:'Air',value:32,unit:'AQI',source:'Test monitor',issued:`${today}T06:00:00Z`,basis:'daily maximum',context:homeId,version:'history-v1'}],comparison:{context:homeId,basis:'daily maximum',version:'history-v1'},complete:true}),
 });
 await page.goto('/plan?destination=patterns');await expect(page.locator('.mw-week-pulse')).toContainText('1 logged');
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export this range, without private notes',exact:true}).click();
 const stream=await(await downloaded).createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const body=Buffer.concat(chunks).toString();const exported=JSON.parse(body);
 expect(exported.entries.map((entry:WeekEntry)=>entry.id)).toEqual(['current-checkin']);expect(body).not.toContain('another-home');expect(body).not.toContain('Original private note');expect(exported.entries[0]).not.toHaveProperty('note');expect(exported.counts.logged).toBe(1);expect(network.blocked).toEqual([]);
});

test('Settings panel URLs restore Back, Forward and reload while retaining unsaved edits',async({page})=>{
 const network=await mockProduction(page);await page.goto('/settings');await page.locator('[data-setting-panel="display"]').click();
 await expect(page).toHaveURL(/open=display/);await page.getByRole('radio',{name:'Light',exact:true}).check();
 await page.goBack();await expect(page.locator('[data-setting-panel="display"]')).toBeVisible();await expect(page).not.toHaveURL(/open=/);
 await page.goForward();await expect(page.getByRole('heading',{name:'Display & accessibility',exact:true})).toBeVisible();await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'All settings',exact:true}).click();await page.locator('[data-setting-panel="privacy"]').click();await expect(page).toHaveURL(/open=privacy/);
 await page.reload();await expect(page.getByRole('heading',{name:'Privacy & data',exact:true})).toBeVisible();
 await page.goto('/settings?open=household');await expect(page.getByRole('heading',{name:'Home & household',exact:true})).toBeVisible();await page.getByRole('button',{name:'All settings',exact:true}).click();await expect(page.locator('[data-setting-panel="home"]')).toBeVisible();
 await page.goto('/settings?open=unknown-panel');await expect(page.locator('[data-setting-panel="display"]')).toBeVisible();expect(network.requests.filter(r=>r.method!=='GET')).toEqual([]);expect(network.blocked).toEqual([]);
});

test('source-follow drafts never claim account persistence or active monitoring',async({page})=>{
 const network=await mockProduction(page);await page.goto('/settings?open=notifications');
 await expect(page.locator('.hp-device-banner')).toContainText('Notification permissions and registration');await expect(page.locator('.hp-device-banner')).not.toContainText('Registered on this device');
 await page.locator('summary').filter({hasText:'Sources to follow'}).click();await page.getByLabel('Place or source name',{exact:true}).fill('Local water provider');await page.getByRole('button',{name:'Keep draft',exact:true}).click();
 await expect(page.locator('.hp-follow')).toContainText('Draft only');await expect(page.getByRole('status').filter({hasText:'Draft kept for this visit. Monitoring is not active.'})).toHaveCount(1);
 expect(network.requests.filter(r=>r.method!=='GET')).toEqual([]);await page.reload();await page.locator('summary').filter({hasText:'Sources to follow'}).click();await expect(page.locator('.hp-follow')).toHaveCount(0);expect(network.blocked).toEqual([]);
});

test('clearing Luna in Settings announces one canonical result',async({page})=>{
 let clears=0;const conversation={id:'review-conversation',revision:7,messages:[{id:'message',role:'assistant',text:'A saved conversation.'}],pendingRequest:null,unresolvedOperations:{}};
 const network=await mockProduction(page,{
  '/api/luna/conversations':route=>jsonRoute(route,conversation),
  '/api/luna/conversations/clear':async route=>{clears++;expect(route.request().headers()['x-halo-if-match']).toBe('7');await jsonRoute(route,{...conversation,revision:8,messages:[]});},
 });
 await page.goto('/settings?open=luna');await page.getByText('Conversation history',{exact:true}).click();await page.getByRole('button',{name:'Clear this conversation',exact:true}).click();await page.getByRole('button',{name:'Yes, clear',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:'Conversation cleared. Saved app records were kept.'})).toHaveCount(1);expect(clears).toBe(1);expect(network.blocked).toEqual([]);
});
