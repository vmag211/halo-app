import {expect,test} from '@playwright/test';
import {mockProduction,settingsSnapshot} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

for(const appearance of ['dark','light']as const)for(const route of ['plan','home','act','settings'])test(`capture reviewed production ${route} in ${appearance}`,async({page})=>{
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date());
 const network=await mockProduction(page,{
  '/api/settings':route=>jsonRoute(route,{...settingsSnapshot,display:{...settingsSnapshot.display,appearance}}),
  '/api/frontend/actions':route=>jsonRoute(route,{actions:[{id:'service-action-1',key:'personal:service-action-1',revision:1,title:'Plan the neighborhood cleanup',reason:'A task you added.',origin:'Personal',state:'saved',date}],metas:{},unresolvedOperations:[]}),
  '/api/daily-score':route=>jsonRoute(route,{air:{aqi:38,severity:'good',source:'open-meteo',is_measured:false,dominant_pollutant:'PM2.5'},uv:{index:2,severity:'good',peak_window:null},pollen:null,mold:null,score:{display_score:81,severity:'good',is_partial:true,missing_inputs:['pollen','mold'],included_inputs:['air','uv'],inputs:{air:15,uv:16,pollen:null,mold:null}},retrieved_at:'2026-10-13T14:00:00Z',cached:false}),
 });
 await page.setViewportSize({width:430,height:932});await page.goto(`/${route}`);
 await expect(page.getByTestId('production-product')).toBeVisible();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode',appearance);
 await page.evaluate(()=>document.fonts.ready);await expect(page.locator('.halo-f-app').first()).toBeVisible();
 expect(await page.locator('.halo-f-app').first().evaluate(node=>node.getBoundingClientRect().width)).toBeLessThanOrEqual(430);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(430);
 await page.screenshot({path:`test-results-production-review/${appearance}-${route}.png`,fullPage:false});
 expect(network.blocked).toEqual([]);
});
