import {expect,test} from '@playwright/test';
import {mockProduction,homeId} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

for(const [path,title]of [['/plan','My Week'],['/today','Today'],['/home','Homeguard'],['/act','Explore'],['/settings','Settings']])test(`production ${path} uses the reviewed mobile shell with real routes`,async({page})=>{
 const network=await mockProduction(page);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewportSize({width:1440,height:1000});await page.goto(path);
 await expect(page.getByTestId('production-product')).toBeVisible();
 await expect(page.locator('.halo-f-header')).toContainText(title);
 await expect(page.locator('a[href*="/foundation/preview"]')).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Lower-level radon test');
 await expect(page.locator('body')).not.toContainText('Kitchen filter upkeep');
 const width=await page.locator('.halo-f-app').first().evaluate(node=>node.getBoundingClientRect().width);expect(width).toBeLessThanOrEqual(430);
 expect(network.requests.some(r=>r.path.startsWith('/api/frontend/workspace'))).toBe(true);
 expect(network.blocked).toEqual([]);expect(errors).toEqual([]);
});

test('missing production collections and actions never expose wireframe records',async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/workspace':route=>jsonRoute(route,{error:'internal private database detail'},503),'/api/frontend/actions':route=>jsonRoute(route,{error:'unavailable'},503)});
 await page.goto('/home');await expect(page.getByTestId('production-product')).toBeVisible();
 await expect(page.locator('body')).not.toContainText('Lower-level radon test');await expect(page.locator('body')).not.toContainText('Back garden');await expect(page.locator('body')).not.toContainText('internal private database detail');
 expect(network.blocked).toEqual([]);
});

test('review query switches cannot replace a production page with fixture or public context',async({page})=>{
 const network=await mockProduction(page);await page.goto('/plan?access=public&scenario=score-full&edition=expanded&tab=home&appearance=light');
 await expect(page.getByTestId('production-product')).toBeVisible();await expect(page.locator('.halo-f-header h1')).toHaveText('My Week');
 await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await expect(page.getByRole('heading',{name:'Explore with HALO'})).toHaveCount(0);await expect(page.locator('a[href*="/preview"]')).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Lower-level radon test');expect(network.blocked).toEqual([]);
});

test('task saves accept only a scoped canonical receipt and survive reload from service',async({page})=>{
 let snapshot:{actions:unknown[];metas:Record<string,unknown>;unresolvedOperations:unknown[]}={actions:[],metas:{},unresolvedOperations:[]};let mutations=0;
 const network=await mockProduction(page,{'/api/frontend/actions':route=>jsonRoute(route,snapshot),'/api/frontend/actions/commands':async route=>{
  mutations++;const body=route.request().postDataJSON();const headers=route.request().headers();expect(headers.authorization).toMatch(/^Bearer /);expect(headers['x-halo-home-context']).toBe(homeId);expect(headers['idempotency-key']).toBe(body.operationId);
  snapshot={actions:body.seeds.map((seed:object)=>({...seed,id:'canonical-task-77',revision:1,state:'saved',date:body.date})),metas:body.metadata,unresolvedOperations:[]};
  await jsonRoute(route,{operationId:body.operationId,status:'succeeded',snapshot});
 }});
 await page.goto('/plan');await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task title').fill('Prepare the community seed swap');await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.getByRole('button',{name:/Prepare the community seed swap/}).first()).toBeVisible();expect(mutations).toBe(1);
 await page.reload();await expect(page.getByRole('button',{name:/Prepare the community seed swap/}).first()).toBeVisible();expect(mutations).toBe(1);expect(network.blocked).toEqual([]);
});

test('unknown task outcome retains the editor and blocks duplicate submits until reconciliation',async({page})=>{
 let commits=0,operationId='';const network=await mockProduction(page,{'/api/frontend/actions/commands':async route=>{commits++;operationId=route.request().postDataJSON().operationId;await route.abort('failed');},'/api/operations':async(route,url)=>{expect(url.searchParams.get('operationId')).toBe(operationId);await jsonRoute(route,{operationId,status:'failed',message:'The save was not applied.'});}});
 await page.goto('/plan');await page.getByRole('button',{name:'Add task',exact:true}).click();await page.getByLabel('Task title').fill('Do not lose my planting plan');await page.getByRole('button',{name:'Save task',exact:true}).click();
 await expect(page.getByLabel('Task title')).toHaveValue('Do not lose my planting plan');await expect(page.getByRole('dialog').getByRole('button',{name:'Check save status',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Save task',exact:true})).toBeDisabled();expect(commits).toBe(1);
 await page.getByRole('dialog').getByRole('button',{name:'Check save status',exact:true}).click();await expect(page.getByLabel('Task title')).toHaveValue('Do not lose my planting plan');expect(commits).toBe(1);expect(network.blocked).toEqual([]);
});

test('an unavailable profile never reveals the private app and offers public browsing',async({page})=>{
 await mockProduction(page,{'/api/profile':route=>jsonRoute(route,{error:'private error'},401)});await page.goto('/plan');
 await expect(page.getByRole('heading',{name:'Let’s reconnect'})).toBeVisible();await expect(page.getByTestId('production-product')).toHaveCount(0);await expect(page.getByRole('link',{name:'Browse public information'})).toHaveAttribute('href','/learn');
});

test('returning completed users land on My Week without redoing onboarding',async({page})=>{
 const network=await mockProduction(page);await page.goto('/onboarding?entry=1');await expect(page).toHaveURL(/\/plan$/);await expect(page.getByTestId('production-product')).toBeVisible();expect(network.blocked).toEqual([]);
});
