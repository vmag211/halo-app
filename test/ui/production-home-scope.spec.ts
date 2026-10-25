import {expect,test,type Page,type Route} from '@playwright/test';
import {homeId,mockProduction} from './production-fixtures';
import {jsonRoute,stageProfile} from './stage-fixtures';

// E25 (YOUR_TODO.md Part 4 items 24 and 25): the app remounts, and drops drafts, only on a genuine home transition.
const nextHomeId='00000000-0000-4000-8000-000000000003';
const located={lat:35.4,lng:-80.5,county:'Cabarrus',state:'NC'};
type Home={id:string;revision:number;location?:typeof located}|null|undefined;
/** A profile answer: `undefined` leaves home_context out (a failed context read), `null` is no home. */
const profileWith=(home:Home)=>({...stageProfile,...(home===undefined?{}:{home_context:home&&{location:located,current:true,...home}})});
/** Serves the profiles in turn (the last one repeats); returns the read count. */
function profiles(...answers:Home[]){const state={reads:0};return {state,route:async(route:Route)=>{const home=answers[Math.min(state.reads,answers.length-1)];state.reads++;await jsonRoute(route,profileWith(home));}};}
const refreshProfile=(page:Page)=>page.evaluate(()=>window.dispatchEvent(new Event('halo:settings-changed')));
async function draftLight(page:Page){await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');await page.locator('[data-setting-panel="display"]').click();await page.getByRole('radio',{name:'Light',exact:true}).check();}
const evidence=(context:string|null)=>({rows:[],comparison:{context,basis:'daily maximum',version:'daily-max-v1'},complete:true});

test('item 24: an in-place home save (same home, revision up) keeps an unsaved settings draft',async({page})=>{
 const profile=profiles({id:homeId,revision:1},{id:homeId,revision:2});
 const network=await mockProduction(page,{'/api/profile':profile.route});
 await draftLight(page);await refreshProfile(page);
 await expect.poll(()=>profile.state.reads).toBe(2);await expect.poll(()=>network.requests.filter(r=>r.path.startsWith('/api/daily-score')).length).toBeGreaterThanOrEqual(2);
 await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();expect(network.blocked).toEqual([]);
});

test('first appearance of home_context, then a re-read that omits it, both keep an unsaved draft',async({page})=>{
 const profile=profiles(undefined,{id:homeId,revision:1},undefined,{id:homeId,revision:1});
 const network=await mockProduction(page,{'/api/profile':profile.route});
 await draftLight(page);
 for(const reads of [2,3,4]){await refreshProfile(page);await expect.poll(()=>profile.state.reads).toBe(reads);await expect.poll(()=>network.requests.filter(r=>r.path.startsWith('/api/daily-score')).length).toBeGreaterThanOrEqual(reads);await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();}
 expect(network.blocked).toEqual([]);
});

test('a real move remounts: the draft is dropped and the screen returns to the saved choice',async({page})=>{
 const profile=profiles({id:homeId,revision:1},{id:nextHomeId,revision:1});
 const network=await mockProduction(page,{'/api/profile':profile.route});
 await draftLight(page);await refreshProfile(page);await expect.poll(()=>profile.state.reads).toBe(2);
 await expect(page.getByRole('radio',{name:'Light',exact:true})).not.toBeChecked();await expect(page.getByRole('radio',{name:'Dark',exact:true})).toBeChecked();expect(network.blocked).toEqual([]);
});

test('Patterns validates once the profile names the home, and a move re-reads history for the new home',async({page})=>{
 const profile=profiles(undefined,{id:homeId,revision:1},{id:nextHomeId,revision:1});const headers:(string|undefined)[]=[];
 // The server answers for the current home, whatever the header says (Ruling E11).
 const current=()=>profile.state.reads>=3?nextHomeId:homeId;
 const network=await mockProduction(page,{'/api/profile':profile.route,'/api/evidence':async route=>{headers.push(route.request().headers()['x-halo-home-context']);await jsonRoute(route,evidence(current()));}});
 await page.goto('/plan?destination=patterns');
 await expect(page.getByText('History could not be verified.',{exact:true})).toBeVisible();expect(headers[0]).toBeUndefined();
 await refreshProfile(page);await expect.poll(()=>headers.at(-1)).toBe(homeId);
 await expect(page.locator('.mw-week-pulse')).toBeVisible();await expect(page.getByText('History could not be verified.',{exact:true})).toHaveCount(0);
 await refreshProfile(page);await expect.poll(()=>headers.at(-1)).toBe(nextHomeId);
 await expect(page.locator('.mw-week-pulse')).toBeVisible();await expect(page.getByText('History could not be verified.',{exact:true})).toHaveCount(0);expect(network.blocked).toEqual([]);
});
