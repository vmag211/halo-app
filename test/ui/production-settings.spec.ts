import {expect,test} from '@playwright/test';
import {mockProduction,settingsSnapshot,homeId} from './production-fixtures';
import {jsonRoute,stageProfile} from './stage-fixtures';

test('display edits apply only after canonical receipt and load unchanged on another visit',async({page})=>{
 let current=structuredClone(settingsSnapshot),saves=0;
 const network=await mockProduction(page,{'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,current);return;}saves++;const input=route.request().postDataJSON();expect(route.request().headers()['if-match']).toBe(String(current.revision));expect(route.request().headers()['idempotency-key']).toBe(input.operationId);current={...current,revision:current.revision+1,values:input.values,display:input.display,calendar:input.calendar};await jsonRoute(route,{operationId:input.operationId,status:'succeeded',snapshot:current});}});
 await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');await page.locator('[data-setting-panel="display"]').click();
 await page.getByRole('radio',{name:'Light',exact:true}).check();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','light');expect(saves).toBe(1);
 await page.reload();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','light');expect(saves).toBe(1);expect(network.blocked).toEqual([]);
});

test('unconfirmed settings save retains the choice and reconciles before any new mutation',async({page})=>{
 let saves=0,id='';const network=await mockProduction(page,{'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,settingsSnapshot);return;}saves++;id=route.request().postDataJSON().operationId;await route.abort('failed');},'/api/operations':async(route,url)=>{expect(url.searchParams.get('domain')).toBe('settings');expect(url.searchParams.get('operationId')).toBe(id);await jsonRoute(route,{operationId:id,status:'failed'});}});
 await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');await page.locator('[data-setting-panel="display"]').click();await page.getByRole('radio',{name:'Light',exact:true}).check();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check save status',exact:true})).toBeVisible();await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');expect(saves).toBe(1);
 await page.getByRole('button',{name:'Check save status',exact:true}).click();await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();expect(saves).toBe(1);expect(network.blocked).toEqual([]);
});

test('same-home profile rechecks preserve unrelated unsaved settings drafts',async({page})=>{
 let profileReads=0,settingsReads=0,release:()=>void=()=>{};
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const network=await mockProduction(page,{
  '/api/profile':async route=>{profileReads++;if(profileReads>1)await pending;await jsonRoute(route,{...stageProfile,home_context:{id:homeId,revision:1},profile:{...stageProfile.profile,home_context_id:homeId}});},
  '/api/settings':async route=>{expect(route.request().method()).toBe('GET');settingsReads++;await jsonRoute(route,settingsSnapshot);},
 });
 await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await page.locator('[data-setting-panel="display"]').click();await page.getByRole('radio',{name:'Light',exact:true}).check();
 await page.evaluate(()=>window.dispatchEvent(new Event('halo:settings-changed')));
 await expect.poll(()=>profileReads).toBe(2);await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
 release();await expect.poll(()=>network.requests.filter(request=>request.path==='/api/daily-score').length).toBe(2);await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
 await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');expect(settingsReads).toBe(1);expect(network.blocked).toEqual([]);
});
