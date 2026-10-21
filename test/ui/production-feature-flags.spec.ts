import {expect,test,type Page} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

/* Switched-off capabilities are learned once per session; their reads are settled in the browser
 * instead of being sent to come back 503. Writes and unknown capability state are unchanged. */
const gated=/^\/api\/(frontend\/workspace|attachments|summaries|projects\/|outreach\/|opportunities|explore\/organizations)/;
const flags=(on:boolean)=>({capabilities:{tasks:true,workspace:on,attachments:on,summaries:on,projects:on,outreach:on,participation:on,luna:false,recovery:false}});
async function visit(page:Page,paths:string[]){
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 for(const path of paths){await page.goto(path);await expect(page.getByTestId('production-product')).toBeVisible();await page.waitForLoadState('networkidle').catch(()=>undefined);}
 return errors;
}
const screens=['/app','/app/homeguard','/app/homeguard/tests','/app/explore','/app/explore/projects','/app/journal'];

test('switched-off capabilities send no workspace, project, outreach or listing reads',async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/capabilities':route=>jsonRoute(route,flags(false))});
 const errors=await visit(page,screens);
 expect(network.requests.filter(r=>gated.test(r.path))).toEqual([]);
 expect(network.requests.filter(r=>r.path==='/api/frontend/capabilities').length).toBeGreaterThan(0);
 expect(network.requests.some(r=>r.path.startsWith('/api/frontend/actions'))).toBe(true);
 expect(network.blocked).toEqual([]);expect(errors).toEqual([]);
});

test('Homeguard says its records are not available yet, with no error or retry',async({page})=>{
 await mockProduction(page,{'/api/frontend/capabilities':route=>jsonRoute(route,flags(false))});
 for(const path of ['/app/homeguard','/app/homeguard/tests']){
  await page.goto(path);
  await expect(page.getByText('Saving Homeguard records is not available yet. Nothing has changed, and the rest of Homeguard still works.')).toBeVisible();
  await expect(page.locator('.hg-error[role="alert"]')).toHaveCount(0);
  await expect(page.getByText(/This service is unavailable|records could not load/)).toHaveCount(0);
  await expect(page.locator('main').getByRole('button',{name:'Try again',exact:true})).toHaveCount(0);
 }
});

test('switched-on capabilities load their collections as before',async({page})=>{
 const network=await mockProduction(page,{'/api/frontend/capabilities':route=>jsonRoute(route,flags(true))});
 const errors=await visit(page,['/app/homeguard/tests']);
 expect(network.requests.filter(r=>r.path.startsWith('/api/frontend/workspace?collection=')).length).toBeGreaterThan(1);
 await expect(page.getByText(/not available yet/)).toHaveCount(0);
 expect(network.blocked).toEqual([]);expect(errors).toEqual([]);
});

for(const [name,handler] of [['fails',(route:import('@playwright/test').Route)=>jsonRoute(route,{error:'boom'},500)],['is malformed',(route:import('@playwright/test').Route)=>jsonRoute(route,{capabilities:{workspace:'off'}})]] as const)
 test(`an unknown capability state (the read ${name}) keeps sending every read`,async({page})=>{
  const network=await mockProduction(page,{'/api/frontend/capabilities':handler});
  await visit(page,['/app/homeguard/tests']);
  expect(network.requests.filter(r=>r.path.startsWith('/api/frontend/workspace?collection=')).length).toBeGreaterThan(1);
 });
