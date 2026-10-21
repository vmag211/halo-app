import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

const notice={id:'canonical-alert-1',revision:1,title:'A report is ready to review',body:'Open the saved test to see the original source.',category:'Home',date:'2026-10-13',read:false,dismissed:false,target:{tab:'home',destination:'tests'},kind:'app'};
const inbox=(items:typeof notice[],unresolvedOperations:string[]=[])=>({items,unresolvedOperations,alerts:[],count:items.length,unread:items.filter(item=>!item.read&&!item.dismissed).length});

test('alerts remain unread on expansion and explicit read, dismiss and undo use exact revisions',async({page})=>{
 let items=[{...notice}],writes=0;
 const network=await mockProduction(page,{
  '/api/alerts':route=>jsonRoute(route,inbox(items)),
  '/api/alerts/state':async route=>{writes++;const input=route.request().postDataJSON();expect(input.selection).toEqual([{id:notice.id,revision:items[0].revision}]);expect(route.request().headers()['idempotency-key']).toBe(input.operationId);items=items.map(item=>({...item,...input.patch,revision:item.revision+1}));await jsonRoute(route,{operationId:input.operationId,status:'succeeded',items,unresolvedOperations:[]});},
 });
 await page.goto('/plan');await page.getByRole('button',{name:'Alerts, 1 unread',exact:true}).click();
 const alerts=page.locator('.halo-alerts');await alerts.getByRole('button',{name:notice.title,exact:true}).click();await expect(alerts).toContainText(notice.body);expect(writes).toBe(0);
 await alerts.getByRole('button',{name:`Mark as read: ${notice.title}`,exact:true}).click();await expect(alerts.locator('[data-unread=true]')).toHaveCount(0);expect(writes).toBe(1);
 await alerts.getByRole('button',{name:`Dismiss alert: ${notice.title}`,exact:true}).click();await expect(alerts.locator('.hp-alert-item')).toHaveCount(0);
 await alerts.getByRole('button',{name:'Undo',exact:true}).click();await expect(alerts.locator('.hp-alert-item')).toHaveCount(1);await expect(alerts.locator('[data-unread=true]')).toHaveCount(0);expect(writes).toBe(3);expect(network.blocked).toEqual([]);
});

test('unresolved alert updates reload in reconciliation mode without another mutation',async({page})=>{
 let writes=0,checks=0;const operationId='canonical-alert-operation';
 const network=await mockProduction(page,{
  '/api/alerts':route=>jsonRoute(route,inbox([{...notice}],[operationId])),
  '/api/alerts/state':async route=>{writes++;await route.abort();},
  '/api/operations':async(route,url)=>{checks++;expect(url.searchParams.get('domain')).toBe('alerts');expect(url.searchParams.get('operationId')).toBe(operationId);await jsonRoute(route,{operationId,status:'succeeded',items:[{...notice,read:true,revision:2}],unresolvedOperations:[]});},
 });
 await page.goto('/plan');await page.getByRole('button',{name:'Alerts, 1 unread',exact:true}).click();const alerts=page.locator('.halo-alerts');
 await expect(alerts.getByRole('button',{name:'Retry or check status',exact:true})).toBeVisible();
 await alerts.getByRole('button',{name:'Retry or check status',exact:true}).click();await expect(alerts.locator('[data-unread=true]')).toHaveCount(0);expect(checks).toBe(1);expect(writes).toBe(0);expect(network.blocked).toEqual([]);
});

test('completed dismiss and undo confirm without offering a retry, and the last dismissal still shows the empty inbox',async({page})=>{
 let items=[{...notice}];
 const network=await mockProduction(page,{
  '/api/alerts':route=>jsonRoute(route,inbox(items)),
  '/api/alerts/state':async route=>{const input=route.request().postDataJSON();items=items.map(item=>({...item,...input.patch,revision:item.revision+1}));await jsonRoute(route,{operationId:input.operationId,status:'succeeded',items,unresolvedOperations:[]});},
 });
 await page.goto('/plan');await page.getByRole('button',{name:'Alerts, 1 unread',exact:true}).click();const alerts=page.locator('.halo-alerts');
 await alerts.getByRole('button',{name:`Dismiss alert: ${notice.title}`,exact:true}).click();
 await expect(alerts.getByText('Alert dismissed.',{exact:true})).toBeVisible();await expect(alerts.getByRole('heading',{name:'You’re all caught up.'})).toBeVisible();
 await expect(alerts.getByRole('button',{name:'Retry or check status',exact:true})).toHaveCount(0);
 await alerts.getByRole('button',{name:'Undo',exact:true}).click();await expect(alerts.getByText('Alert restored.',{exact:true})).toBeVisible();await expect(alerts.locator('.hp-alert-item')).toHaveCount(1);
 await expect(alerts.getByRole('button',{name:'Retry or check status',exact:true})).toHaveCount(0);
 expect(network.blocked).toEqual([]);
});
