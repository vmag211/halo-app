import {expect,test} from '@playwright/test';
import {mockStage,jsonRoute} from './stage-fixtures';
import {sourceOperationFixtures,applySourceOperation,type SourceOperation} from '../../lib/frontend/source-operations-preview';
const source=()=>({...sourceOperationFixtures()[0],allowedDecisions:['approve','quarantine','publish','withdraw','translation','retry','rollback','publish-translation'],publishedTranslations:[],versionsCursor:null,auditCursor:null});
test('ordinary authenticated users never receive operator controls or choose their role',async({page})=>{
 const network=await mockStage(page,{overrides:{'/api/operator/sources':route=>jsonRoute(route,{role:'denied',revision:1,sources:[],unresolvedOperations:[],nextCursor:null})}});await page.goto('/operations');await expect(page.getByText('Source operations require a verified operator role. Household access does not grant source permissions.',{exact:true})).toBeVisible();await expect(page.getByRole('combobox')).toHaveCount(0);await expect(page.getByRole('group',{name:'Source decisions'})).toHaveCount(0);expect(network.requests.filter(row=>row.method!=='GET')).toEqual([]);expect(network.blocked).toEqual([]);
});
test('verified source reviewer cannot publish, and approve waits for the canonical audited receipt',async({page})=>{
 let current={role:'reviewer',revision:1,sources:[source()],unresolvedOperations:[],nextCursor:null};let writes=0;
 const network=await mockStage(page,{overrides:{'/api/operator/sources':route=>jsonRoute(route,current),'/api/operator/sources/commands':async route=>{const command=route.request().postDataJSON();writes++;expect(command.decision).toBe('approve');expect(route.request().headers()['x-halo-if-match']).toBe('1');const result=applySourceOperation(current.sources[0],{...command,requestId:command.operationId} as SourceOperation,'reviewer');current={...current,revision:2,sources:[{...current.sources[0],...result.source}]};await jsonRoute(route,{operationId:command.operationId,status:'succeeded',snapshot:current});}}});
 await page.goto('/operations');await expect(page.getByRole('button',{name:'Publish reviewed content',exact:true})).toBeDisabled();await page.getByLabel('Decision reason').fill('Reviewed all source changes and current limitations.');await page.getByRole('button',{name:'Approve candidate',exact:true}).click();expect(writes).toBe(0);await expect(page.getByRole('region',{name:'Source decision review'})).toBeVisible();await page.getByRole('button',{name:'Confirm decision',exact:true}).click();await expect(page.getByText('Decision recorded. Household records and historical evidence are retained.',{exact:true})).toBeVisible();expect(writes).toBe(1);expect(network.blocked).toEqual([]);
});
test('unknown publication outcome blocks new decisions and refresh restores its durable operation',async({page})=>{
 const current={role:'publisher',revision:1,sources:[source()],unresolvedOperations:['earlier-operation'],nextCursor:null};let statuses=0;
 const network=await mockStage(page,{overrides:{'/api/operator/sources':route=>jsonRoute(route,current),'/api/operations':async(route,url)=>{statuses++;expect(url.searchParams.get('domain')).toBe('source-operations');expect(url.searchParams.get('operationId')).toBe('earlier-operation');current.unresolvedOperations=[];await jsonRoute(route,{operationId:'earlier-operation',status:'failed'});}}});
 await page.goto('/operations');await expect(page.getByRole('button',{name:'Approve candidate',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Check operation status',exact:true}).click();await expect(page.getByRole('button',{name:'Approve candidate',exact:true})).toBeEnabled();expect(statuses).toBe(1);expect(network.requests.filter(row=>row.method!=='GET')).toEqual([]);expect(network.blocked).toEqual([]);
});

test('the operator denial keeps phone gutters and a real heading',async({page})=>{
 await page.setViewportSize({width:375,height:812});
 await mockStage(page,{overrides:{'/api/operator/sources':route=>jsonRoute(route,{role:'denied',revision:1,sources:[],unresolvedOperations:[],nextCursor:null})}});
 await page.goto('/operations');const heading=page.getByRole('heading',{name:'Source operations',exact:true,level:1});await expect(heading).toBeVisible();
 const box=(await page.locator('main.source-ops-review').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(16);expect(box.x+box.width).toBeLessThanOrEqual(375-16);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
 const size=async(selector:string)=>page.locator(selector).first().evaluate(element=>parseFloat(getComputedStyle(element).fontSize));
 expect(await size('main.source-ops-review h1')).toBeGreaterThan(await size('main.source-ops-review p'));
});
