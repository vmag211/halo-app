import {expect,test,type Page,type Route} from '@playwright/test';

const sampleMap={layer:'water',assembled_at:'2026-10-13T14:00:00Z',quarters:['2026Q1','2026Q2'],features:[{pwsid:'REAL-PWS-88',name:'Contract Test Utility',lat:35.15,lng:-80.4,population:2300,overall_severity:'moderate',coverage:'partial',latest_sample_iso:'2026-04-10',contaminants:{PFOS:{value_ppt:2.3,limit_ppt:4,ratio:.575,severity:'moderate',date_iso:'2026-04-10'}},detected_unregulated:[]}],own_home:{lat:35.15,lng:-80.4,county:'PRIVATE COUNTY MUST NOT SHOW',score:81,pwsid:'REAL-PWS-88'}};
async function protect(page:Page,handler?:(route:Route,url:URL)=>Promise<void>){
 const forbidden:string[]=[],requests:string[]=[],headers:Record<string,string>[]=[];
 await page.route('**/*',async route=>{const url=new URL(route.request().url());
  if(!['127.0.0.1','localhost'].includes(url.hostname)){forbidden.push(url.origin+url.pathname);await route.abort();return;}
  if(!url.pathname.startsWith('/api/')){await route.continue();return;}
  requests.push(url.pathname+url.search);headers.push(route.request().headers());
  if(handler&&['/api/map','/api/district'].includes(url.pathname)){await handler(route,url);return;}
  forbidden.push(url.pathname);await route.abort();
 });return {forbidden,requests,headers};
}
const json=(route:Route,value:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});

test('public Learn opens without session, private requests or preview links',async({page})=>{
 const network=await protect(page);await page.goto('/learn');
 await expect(page.getByTestId('public-product')).toBeVisible();
 await expect(page.getByRole('heading',{name:'Explore with HALO'})).toBeVisible();
 await expect(page.locator('a[href*="/preview"]')).toHaveCount(0);
 await expect(page.getByRole('link',{name:'Set up your home'})).toHaveAttribute('href','/onboarding?entry=1');
 expect(network.requests).toEqual([]);expect(network.forbidden).toEqual([]);
});
test('public map uses actual records and ignores fake review scenario in URL',async({page})=>{
 const network=await protect(page,async(route,url)=>json(route,url.pathname==='/api/map'?sampleMap:{error:'not ready'},url.pathname==='/api/map'?200:503));
 await page.goto('/map?mapScenario=ready&comparisonCase=ready');
 await expect(page.getByTestId('map-product')).toBeVisible();
 await expect(page.getByText('Loading map data.',{exact:true})).toHaveCount(0);
 await expect(page.getByText(/Map design review/)).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Locate your home'})).toHaveCount(0);
 await page.getByRole('button',{name:'Find a location'}).click();
 await expect(page.getByRole('dialog')).toContainText('Contract Test Utility');
 await page.getByRole('button',{name:/Contract Test Utility/}).click();
 await expect(page.getByRole('dialog')).toContainText('REAL-PWS-88');
 await expect(page.getByRole('dialog')).toContainText('2.3 ppt');
 await expect(page.locator('body')).not.toContainText('Meadow Water');
 await expect(page.locator('body')).not.toContainText('PRIVATE COUNTY MUST NOT SHOW');
 expect(network.headers.every(headers=>!headers.authorization&&!headers['x-halo-home-context'])).toBe(true);
 expect(network.forbidden).toEqual([]);
});
test('unavailable map has retry and never substitutes sample evidence or session signup',async({page})=>{
 const network=await protect(page,route=>json(route,{error:'database private detail'},503));await page.goto('/map');
 await expect(page.locator('.halo-map-state[role="alert"]')).toContainText('couldn’t load');
 await expect(page.locator('body')).not.toContainText('Meadow Water');
 await expect(page.locator('body')).not.toContainText('database private detail');
 await page.getByRole('button',{name:'Try again',exact:true}).click();
 await expect.poll(()=>network.requests.length).toBeGreaterThan(1);
 expect(network.forbidden).toEqual([]);
});
test('real layer switch retains missing air values as unavailable and counts only returned stations',async({page})=>{
 const network=await protect(page,async(route,url)=>json(route,url.searchParams.get('layer')==='air'?{layer:'air',features:[{id:'REAL-AIR-1',name:'Source Monitor',lat:35.15,lng:-80.4,aqi:null,severity:'no_data',last_reading_at:null,agency:'Official agency'}],assembled_at:'2026-10-13T14:00:00Z'}:sampleMap));
 await page.goto('/map');await expect(page.getByText('Loading map data.',{exact:true})).toHaveCount(0);
 await page.getByRole('radio',{name:'Air',exact:true}).click();
 await expect(page.getByText('Loading map data.',{exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Find a location'}).click();await page.getByRole('button',{name:/Source Monitor/}).click();
 await expect(page.getByRole('dialog')).toContainText('No data');await expect(page.getByRole('dialog')).toContainText('No observation time available');
 expect(network.requests.some(path=>path.includes('layer=air'))).toBe(true);expect(network.forbidden).toEqual([]);
});
test('district source failure never exposes review totals or exports',async({page})=>{
 const network=await protect(page,(route,url)=>json(route,url.pathname==='/api/map'?sampleMap:{error:'unavailable'},url.pathname==='/api/map'?200:503));
 await page.goto('/map');await page.getByRole('button',{name:'See the full NC-08 picture'}).click();
 await expect(page.getByRole('dialog')).toContainText('District information could not load');
 await expect(page.getByRole('dialog')).not.toContainText('66,600');
 await expect(page.getByRole('dialog').getByRole('button',{name:'Download'})).toHaveCount(0);
 expect(network.forbidden).toEqual([]);
});

test('pagination retains unmapped observations and loads the exact continuation cursor',async({page})=>{
 const network=await protect(page,(route,url)=>json(route,{layer:'air',assembled_at:'2026-10-13T14:00:00Z',features:[url.searchParams.has('cursor')?{id:'unmapped-second',name:'Second unlocated monitor',aqi:21}:{id:'unmapped-first',name:'First unlocated monitor',aqi:0}],next_cursor:url.searchParams.has('cursor')?null:'canonical-next-page'}));
 await page.goto('/map?layer=air');await page.getByRole('button',{name:'Find a location'}).click();
 await expect(page.getByRole('button',{name:/First unlocated monitor/})).toBeVisible();
 await page.getByRole('button',{name:'Load more locations',exact:true}).click();
 await expect(page.getByRole('button',{name:/Second unlocated monitor/})).toBeVisible();
 await expect(page.getByRole('button',{name:/First unlocated monitor/})).toBeVisible();
 expect(network.requests.some(path=>path.includes('cursor=canonical-next-page'))).toBe(true);
 await page.getByRole('button',{name:/First unlocated monitor/}).click();await expect(page.getByRole('dialog')).toContainText('0');await expect(page.getByRole('button',{name:'Focus on map'})).toBeDisabled();
 expect(network.forbidden).toEqual([]);
});
