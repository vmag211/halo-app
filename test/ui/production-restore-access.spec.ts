import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

test('public Learn recovery is deliberate, verifies ownership and requires explicit account-switch approval',async({page})=>{
 let requests=0,completes=0,requestId='',nonce='';
 const network=await mockProduction(page,{
  '/api/recovery/request':async route=>{const body=route.request().postDataJSON();requests++;requestId=body.operationId;nonce=body.clientNonce;expect(nonce.length).toBeGreaterThan(60);expect(body.email).toBe('member@example.com');await jsonRoute(route,{operationId:body.operationId,status:'pending',challengeId:'challenge',expiresAt:'2099-01-01T00:00:00Z'});},
  '/api/recovery/status':async route=>{const body=route.request().postDataJSON();expect(body.clientNonce).toBe(nonce);expect(body.requestOperationId).toBe(requestId);await jsonRoute(route,{operationId:body.operationId,status:'verified',challengeId:'challenge',expiresAt:'2099-01-01T00:00:00Z',restoreToken:'isolated-proof'});},
  '/api/recovery/complete':async route=>{const body=route.request().postDataJSON();completes++;expect(body.confirmAccountSwitch).toBe(true);expect(body.restoreToken).toBe('isolated-proof');await jsonRoute(route,{operationId:body.operationId,status:'collision',challengeId:'challenge',expiresAt:null});},
 });
 await page.goto('/learn');await expect(page.getByText('Restore access',{exact:true})).toBeVisible();expect(requests).toBe(0);
 await page.getByText('Restore access',{exact:true}).click();await page.getByLabel('Recovery email',{exact:true}).fill('member@example.com');await page.getByRole('button',{name:'Request recovery link',exact:true}).click();await expect(page.getByText(/If this address has recovery set up/)).toBeVisible();expect(completes).toBe(0);
 await page.getByRole('button',{name:'Check recovery status',exact:true}).click();const restore=page.getByRole('button',{name:'Restore my account',exact:true});await expect(restore).toBeDisabled();expect(completes).toBe(0);
 await page.getByLabel('I want to switch this browser to my recovered account.').check();await restore.click();await expect(page.getByText(/Nothing has been merged/)).toBeVisible();expect(completes).toBe(1);expect(network.blocked).toEqual([]);
 expect(network.requests.filter(r=>r.path.startsWith('/api/profile')||r.path.startsWith('/api/frontend/'))).toEqual([]);
 expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('isolated-proof');
});

test('lost recovery request is reconciled with the same nonce and operation without a duplicate send',async({page})=>{
 let writes=0,id='',nonce='';
 await mockProduction(page,{
  '/api/recovery/request':async route=>{const body=route.request().postDataJSON();writes++;id=body.operationId;nonce=body.clientNonce;await route.abort('failed');},
  '/api/recovery/status':async route=>{const body=route.request().postDataJSON();expect(body.operationId).toBe(id);expect(body.requestOperationId).toBe(id);expect(body.clientNonce).toBe(nonce);expect(body.scope).toBe('request');await jsonRoute(route,{operationId:id,status:'pending',challengeId:'recovered-challenge',expiresAt:'2099-01-01T00:00:00Z'});},
 });
 await page.goto('/learn');await page.getByText('Restore access',{exact:true}).click();await page.getByLabel('Recovery email',{exact:true}).fill('member@example.com');await page.getByRole('button',{name:'Request recovery link',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check earlier recovery request',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Request recovery link',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Check earlier recovery request',exact:true}).click();await expect(page.getByRole('button',{name:'Check recovery status',exact:true})).toBeVisible();expect(writes).toBe(1);
});

for(const status of ['expired','failed'])test(`recovery ${status} permits a fresh verification request without claiming access restored`,async({page})=>{
 let ids:string[]=[];
 await mockProduction(page,{'/api/recovery/request':async route=>{const body=route.request().postDataJSON();ids=[...ids,body.operationId];await jsonRoute(route,{operationId:body.operationId,status,challengeId:'challenge',expiresAt:null});}});
 await page.goto('/learn');await page.getByText('Restore access',{exact:true}).click();await page.getByLabel('Recovery email',{exact:true}).fill('member@example.com');await page.getByRole('button',{name:'Request recovery link',exact:true}).click();await expect(page.getByText(status==='expired'?'This request expired. Request a new verification link.':'Recovery did not complete. No accounts were merged.',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Request recovery link',exact:true}).click();await expect.poll(()=>ids.length).toBe(2);expect(ids[0]).not.toBe(ids[1]);await expect(page).toHaveURL(/\/learn/);
});
