import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

test('privacy uses a server-scoped review and never equates opening it with deletion',async({page})=>{
 let inspections=0,clears=0;
 const network=await mockProduction(page,{'/api/privacy/status':route=>jsonRoute(route,{unresolvedOperations:[]}),'/api/privacy/export/inspect':async route=>{inspections++;expect(route.request().postDataJSON().scope).toBe('journal');await jsonRoute(route,{reviewToken:'review-journal',expiresAt:new Date(Date.now()+60000).toISOString(),count:2,preview:{journal:['entry-1','entry-2']}});},'/api/privacy/clear':async route=>{clears++;const input=route.request().postDataJSON();expect(input.reviewToken).toBe('review-journal');expect(input.scope).toBe('journal');expect(route.request().headers()['idempotency-key']).toBe(input.operationId);await jsonRoute(route,{operationId:input.operationId,status:'succeeded'});}});
 await page.goto('/settings');await page.locator('[data-setting-panel="privacy"]').click();await page.getByRole('button',{name:'Clear Journal',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Clear Journal?',exact:true})).toBeVisible();expect(inspections).toBe(1);expect(clears).toBe(0);
 await page.getByRole('button',{name:'Keep my data',exact:true}).click();expect(clears).toBe(0);
 await page.getByRole('button',{name:'Clear Journal',exact:true}).click();await page.getByRole('button',{name:'Confirm clearing',exact:true}).click();await expect(page.getByText('Journal cleared.',{exact:true})).toBeVisible();expect(clears).toBe(1);expect(network.blocked).toEqual([]);
});

test('reload restores an unresolved destructive privacy request and only checks its status',async({page})=>{
 let checks=0;
 const network=await mockProduction(page,{'/api/privacy/status':route=>jsonRoute(route,{unresolvedOperations:[{operationId:'previous-clear',scope:'all'}]}),'/api/operations':async(route,url)=>{checks++;expect(url.searchParams.get('operationId')).toBe('previous-clear');expect(url.searchParams.get('domain')).toBe('privacy');await jsonRoute(route,{operationId:'previous-clear',status:'failed'});}});
 await page.goto('/settings?open=privacy');await expect(page.getByRole('button',{name:'Check request status',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Clear all app records',exact:true})).toBeDisabled();
 await page.getByRole('button',{name:'Check request status',exact:true}).click();await expect(page.getByText('The request was not applied. Your data is unchanged.',{exact:true})).toBeVisible();expect(checks).toBe(1);expect(network.requests.filter(request=>request.path==='/api/privacy/clear')).toHaveLength(0);expect(network.blocked).toEqual([]);
});
