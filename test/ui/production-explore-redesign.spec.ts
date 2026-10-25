import { expect, test } from '@playwright/test';
import { mockProduction } from './production-fixtures';
import { jsonRoute } from './stage-fixtures';

const opportunity = {
  id:'test-tree-session', organizer:'Test organizer', title:'Community tree session', interest:'Trees & habitat', artwork:'tree',
  scopes:['charlotte'], area:'Charlotte', venue:'Community park', address:'123 Test meeting road',
  kind:'scheduled', startsAt:'2026-10-24T01:00:00Z', endsAt:'2026-10-24T03:00:00Z',
  timeLabel:'Friday, October 23 at 9pm', checkedAt:'2026-10-16', status:'listed', url:'https://example.org/official-session',
  summary:'A source fixture, never a real advertised event.', work:['Check in','Help with assigned planting'], duration:'2 hours',
  cost:'No fee', age:'Ask the organizer', access:'Confirm suitable access', bring:'Follow organizer instructions', join:'Use the official page', safety:'Follow the site team.',
};

test('an empty production hub has one project entrance and no pretend refresh controls', async ({ page }) => {
  const network = await mockProduction(page);
  await page.goto('/app/explore');
  await expect(page.getByRole('button',{name:'Projects for you: see recommendations',exact:true})).toBeVisible();
  await expect(page.locator('.ex-personalized-preview button')).toHaveCount(1);
  await expect(page.locator('.ex-involvement-preview button')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Refresh ideas',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Projects for you: see recommendations',exact:true}).click();
  await expect(page.getByRole('button',{name:'Show my recommendations',exact:true})).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Preferences',exact:true})).toHaveCount(1);
  await expect(page.getByRole('searchbox',{name:'Find a project'})).toHaveCount(0);
  expect(network.blocked).toEqual([]);
});

for (const sourceZone of [true,false]) test(`participation ${sourceZone?'uses the venue day across UTC midnight':'requires a date when the venue zone is unknown'}`, async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-16T16:00:00Z'));
  const item = {...opportunity,...(sourceZone?{venueTimezone:'America/New_York',venueTimezoneBasis:'source'}:{})};
  const network = await mockProduction(page, {
    '/api/opportunities': route => jsonRoute(route,{items:[item],areaLabel:'Charlotte',checkedAt:'2026-10-16',availability:'ready',nextCursor:null,complete:true}),
    '/api/explore/organizations': route => jsonRoute(route,{items:[],nextCursor:null,complete:true}),
  });
  await page.goto('/app/explore/activities');
  await page.locator('.ex-opportunity-card').click();
  await page.getByRole('button',{name:'Plan my participation',exact:true}).click();
  await expect(page.getByLabel('Activity date (optional)')).toHaveValue(sourceZone?'2026-10-23':'');
  await expect(page.getByLabel('Opportunity name (required)')).toHaveValue(opportunity.title);
  if(!sourceZone) await expect(page.getByLabel('My preparation and access questions')).toHaveValue(/Confirm the venue-local calendar date/);
  expect(network.blocked).toEqual([]);
});

test('opportunity conditions handoff needs confirmation and retains the actual venue date and place', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-16T16:00:00Z'));
  const forecasts: {date:string|null;place:string|null}[] = [];
  const item = {...opportunity,venueTimezone:'America/New_York',venueTimezoneBasis:'source'};
  const network = await mockProduction(page, {
    '/api/opportunities': route => jsonRoute(route,{items:[item],areaLabel:'Charlotte',checkedAt:'2026-10-16',availability:'ready',nextCursor:null,complete:true}),
    '/api/explore/organizations': route => jsonRoute(route,{items:[],nextCursor:null,complete:true}),
    '/api/forecast': (route,url) => { forecasts.push({date:url.searchParams.get('date'),place:url.searchParams.get('place')}); return jsonRoute(route,{error:'No forecast fixture'},503); },
  });
  await page.goto('/app/explore/activities');
  await page.locator('.ex-opportunity-card').click();
  await page.getByRole('button',{name:'Check outdoor conditions',exact:true}).click();
  await expect(page.getByRole('region',{name:'Opportunity conditions handoff'})).toContainText('123 Test meeting road');
  expect(forecasts).toEqual([]);
  await page.getByRole('button',{name:'Use opportunity details',exact:true}).click();
  await expect(page.getByLabel('What would you like to do?')).toHaveValue(opportunity.title);
  await expect(page.getByLabel('Area or place (optional)')).toHaveValue('123 Test meeting road');
  await expect(page.getByLabel('Date',{exact:true})).toHaveValue('2026-10-23');
  await expect.poll(()=>forecasts).toContainEqual({date:'2026-10-23',place:'123 Test meeting road'});
  expect(page.url()).not.toContain('123');
  expect(network.blocked).toEqual([]);
});
