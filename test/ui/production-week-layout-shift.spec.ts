import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';

declare global { interface Window { haloShifts: number[] } }

// Pending indicators must not push My Week down and back once readings and tasks settle.
for(const path of ['/app','/app/journal'])test(`${path} loads without a large layout shift at phone width`,async({page})=>{
  await page.addInitScript(()=>{
    window.haloShifts=[];
    new PerformanceObserver(list=>{for(const entry of list.getEntries() as (PerformanceEntry&{value:number;hadRecentInput:boolean})[])if(!entry.hadRecentInput)window.haloShifts.push(entry.value);}).observe({type:'layout-shift',buffered:true});
  });
  await mockProduction(page);
  await page.goto(path);
  await expect(page.locator('.mw-workspace').first()).toBeVisible();
  await page.waitForTimeout(2500);
  const total=(await page.evaluate(()=>window.haloShifts)).reduce((sum,value)=>sum+value,0);
  expect(total).toBeLessThan(0.05);
});
