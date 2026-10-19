import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {communityOpportunities} from '../../lib/frontend/explore-opportunities';

test('a long organizer address is retained and requires a deliberate planning area',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-16T16:00:00Z'));
 const address='123 Environmental Learning Center Road, North entrance beside the community greenhouse and volunteer check-in pavilion, Charlotte, NC 28202';
 expect(address.length).toBeGreaterThan(100);
 const item={...communityOpportunities[0],address,startsAt:'2026-10-24T14:00:00Z',endsAt:'2026-10-24T16:00:00Z',venueTimezone:'America/New_York',venueTimezoneBasis:'source'};
 const forecasts:{date:string|null;place:string|null}[]=[];
 let writes=0;
 const network=await mockProduction(page,{
  '/api/opportunities':route=>jsonRoute(route,{items:[item],areaLabel:'Charlotte',checkedAt:'2026-10-16',availability:'ready',nextCursor:null,complete:true}),
  '/api/explore/organizations':route=>jsonRoute(route,{items:[],nextCursor:null,complete:true}),
  '/api/forecast':(route,url)=>{forecasts.push({date:url.searchParams.get('date'),place:url.searchParams.get('place')});return jsonRoute(route,{error:'No forecast fixture'},503);},
  '/api/frontend/actions/commands':async route=>{writes++;await route.abort();},
 });
 await page.goto('/app/explore/activities');
 await page.locator('.ex-opportunity-card').click();
 await page.getByRole('button',{name:'Check outdoor conditions',exact:true}).click();
 await expect(page.getByRole('region',{name:'Opportunity conditions handoff'})).toContainText(address);
 await page.getByRole('button',{name:'Use opportunity details',exact:true}).click();
 await expect(page.getByLabel('Area or place (optional)')).toHaveValue(address);
 const review=page.getByRole('region',{name:'Review planning area',exact:true});
 await expect(review).toBeVisible();
 await expect(review.getByRole('button',{name:'Use this planning area',exact:true})).toBeDisabled();
 expect(forecasts).toEqual([]);
 await page.getByText('Opportunity context',{exact:true}).click();
 await expect(page.locator('details').filter({has:page.getByText('Opportunity context',{exact:true})})).toContainText(address);
 await page.getByLabel('Area or place (optional)').fill('Environmental Learning Center, Charlotte, NC 28202');
 await expect(review.getByRole('button',{name:'Use this planning area',exact:true})).toBeEnabled();
 expect(forecasts).toEqual([]);
 await review.getByRole('button',{name:'Use this planning area',exact:true}).click();
 await expect(review).not.toBeVisible();
 await expect.poll(()=>forecasts).toContainEqual({date:'2026-10-24',place:'Environmental Learning Center, Charlotte, NC 28202'});
 expect(forecasts.every(request=>request.place!==address.slice(0,100))).toBe(true);
 expect(page.url()).not.toContain('Environmental');
 expect(writes).toBe(0);
 expect(network.blocked).toEqual([]);
});

test('declining opportunity details keeps the outdoor draft and never saves a task',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-10-16T16:00:00Z'));
 const item={...communityOpportunities[0],startsAt:'2026-10-24T14:00:00Z',endsAt:'2026-10-24T16:00:00Z',venueTimezone:'America/New_York',venueTimezoneBasis:'source',title:'A new planting opportunity'};
 let writes=0;
 const network=await mockProduction(page,{
  '/api/opportunities':route=>jsonRoute(route,{items:[item],areaLabel:'Charlotte',checkedAt:'2026-10-16',availability:'ready',nextCursor:null,complete:true}),
  '/api/explore/organizations':route=>jsonRoute(route,{items:[],nextCursor:null,complete:true}),
  '/api/forecast':route=>jsonRoute(route,{error:'No forecast fixture'},503),
  '/api/frontend/actions':async route=>{if(route.request().method()!=='GET'){writes++;await route.abort();return;}await jsonRoute(route,{actions:[],metas:{},unresolvedOperations:[]});},
 });
 await page.goto('/app/plan/outdoors');
 await page.getByLabel('What would you like to do?').fill('My original unsaved walk');
 await page.getByLabel('Area or place (optional)').fill('My chosen park');
 await page.getByLabel('Date',{exact:true}).fill('2026-10-21');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'Explore',exact:true}).click();
 await page.getByRole('button',{name:'Get involved: find local volunteering and organizations',exact:true}).click();
 await page.locator('.ex-opportunity-card').click();
 await page.getByRole('button',{name:'Check outdoor conditions',exact:true}).click();
 const handoff=page.getByRole('region',{name:'Opportunity conditions handoff',exact:true});
 await expect(handoff).toContainText('Your current draft stays');
 await expect(page.getByLabel('What would you like to do?')).toHaveValue('My original unsaved walk');
 await handoff.getByRole('button',{name:'Keep current plan',exact:true}).click();
 await expect(handoff).not.toBeVisible();
 await expect(page.getByLabel('What would you like to do?')).toHaveValue('My original unsaved walk');
 await expect(page.getByLabel('Area or place (optional)')).toHaveValue('My chosen park');
 await expect(page.getByLabel('Date',{exact:true})).toHaveValue('2026-10-21');
 expect(writes).toBe(0);
 expect(network.blocked).toEqual([]);
});
