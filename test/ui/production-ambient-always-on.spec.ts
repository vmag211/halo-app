import {expect,test} from '@playwright/test';
import {mockProduction,settingsSnapshot} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

/** Ambient animation is always on (2026-10-21). Device and app reduced motion still stop it. */
const snapshotWith=(display:Partial<typeof settingsSnapshot.display>)=>({...structuredClone(settingsSnapshot),display:{...settingsSnapshot.display,...display}});

test('a stored ambient off still animates, Settings has no switch, and a display save stores it on',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 let current=snapshotWith({motion:'system',ambient:false});const saved:unknown[]=[];
 const network=await mockProduction(page,{'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,current);return;}const input=route.request().postDataJSON();saved.push(input.display);current={...current,revision:current.revision+1,values:input.values,display:input.display,calendar:input.calendar};await jsonRoute(route,{operationId:input.operationId,status:'succeeded',snapshot:current});}});
 await page.goto('/app');
 await expect(page.locator('.mw-ambience')).toHaveAttribute('data-moving','true');
 await page.goto('/settings');await page.locator('[data-setting-panel="display"]').click();
 await expect(page.getByRole('switch',{name:'Ambient animation',exact:true})).toHaveCount(0);
 await page.getByRole('radio',{name:'Light',exact:true}).check();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect.poll(()=>saved.length).toBe(1);
 expect(saved[0]).toMatchObject({appearance:'light',ambient:true});
 expect(network.blocked).toEqual([]);
});

test('app reduced motion still stops the always-on ambient animation',async({page})=>{
 await page.emulateMedia({reducedMotion:'no-preference'});
 const network=await mockProduction(page,{'/api/settings':route=>jsonRoute(route,snapshotWith({motion:'reduce',ambient:true}))});
 await page.goto('/app');
 await expect(page.locator('.mw-ambience')).toHaveAttribute('data-moving','false');
 expect(network.blocked).toEqual([]);
});
