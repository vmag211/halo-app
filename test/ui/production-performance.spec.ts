import {expect,test} from '@playwright/test';
import {homeId,mockProduction,settingsSnapshot} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

test('primary routes stay within local load and layout-shift regression budgets',async({page},info)=>{
 test.setTimeout(90000);const network=await mockProduction(page);await page.setViewportSize({width:390,height:844});
 await page.addInitScript(()=>{
  const state=window as Window&{haloCLS?:number};state.haloCLS=0;
  new PerformanceObserver(list=>{for(const entry of list.getEntries()){const shift=entry as PerformanceEntry&{hadRecentInput:boolean;value:number};if(!shift.hadRecentInput)state.haloCLS=(state.haloCLS??0)+shift.value;}}).observe({type:'layout-shift',buffered:true});
 });
 const metrics=[];
 for(const path of ['/app','/app/today','/app/homeguard','/app/explore','/app/settings']){
  const start=Date.now();await page.goto(path);await expect(page.getByTestId('production-product')).toBeVisible();await page.evaluate(()=>document.fonts.ready);
  await expect(page.locator('.halo-f-main')).toBeVisible();await page.waitForTimeout(350);
  const metric={path,loadMs:Date.now()-start,cls:await page.evaluate(()=>(window as Window&{haloCLS?:number}).haloCLS??0)};metrics.push(metric);
  expect(metric.loadMs,`${path} local route budget`).toBeLessThan(10000);expect(metric.cls,`${path} CLS`).toBeLessThan(.25);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 expect(network.blocked).toEqual([]);await info.attach('route-metrics',{body:JSON.stringify({metrics,budgets:{loadMs:10000,cls:.25},scope:'Local Chromium with controlled services. Not a field Core Web Vitals claim.'}),contentType:'application/json'});
});

test('history chart updates are bounded and selecting a day does not rebuild its SVG',async({page},info)=>{
 await page.clock.setFixedTime(new Date('2026-10-15T16:00:00Z'));
 const rows=Array.from({length:84},(_,i)=>({date:new Date(Date.UTC(2026,9,15-i)).toISOString().slice(0,10),factor:'Air',value:20+i%50,unit:'AQI',source:'Controlled monitor',issued:'2026-10-15T12:00:00Z',basis:'daily maximum',context:homeId,version:'history-v1'})).reverse();
 await mockProduction(page,{'/api/evidence':route=>jsonRoute(route,{rows,comparison:{context:homeId,basis:'daily maximum',version:'history-v1'},complete:true})});
 const start=Date.now();await page.goto('/app/plan/patterns');const chart=page.locator('.we-chart');await expect(chart).toBeVisible();
 const chartMs=Date.now()-start;expect(chartMs).toBeLessThan(10000);await expect(chart.locator('line')).toHaveCount(84);
 await chart.evaluate(node=>{node.setAttribute('data-original-chart','true');});
 await page.locator('.we-grid button').first().click();await expect(chart).toHaveAttribute('data-original-chart','true');
 const switchStart=Date.now();await page.getByRole('button',{name:'Table',exact:true}).click();await expect(page.locator('.we-table-wrap tbody tr')).toHaveCount(84);const tableMs=Date.now()-switchStart;expect(tableMs).toBeLessThan(2000);
 await info.attach('chart-metrics',{body:JSON.stringify({rows:84,chartMs,tableMs,budgets:{chartMs:10000,tableMs:2000},scope:'Local controlled-service render; SVG identity preserved across unrelated day selection.'}),contentType:'application/json'});
});

test('visible ambient motion stays within a bounded local frame budget and stops under device reduction',async({page},info)=>{
 await mockProduction(page,{'/api/settings':route=>jsonRoute(route,{...settingsSnapshot,display:{...settingsSnapshot.display,motion:'system',ambient:true}})});await page.emulateMedia({reducedMotion:'no-preference'});
 await page.goto('/app/today');await expect(page.getByTestId('production-product')).toBeVisible();
 await expect(page.locator('.halo-environment-scene .halo-env[data-moving=true]')).toBeVisible();
 await page.evaluate(()=>document.fonts.ready);
 const metrics=await page.evaluate(()=>new Promise<{frames:number;p95Ms:number;longFrameFraction:number}>(resolve=>{
  const gaps:number[]=[];let first=0,last=0;
  function frame(now:number){if(!first)first=now;if(last)gaps.push(now-last);last=now;
   if(now-first<2000){requestAnimationFrame(frame);return;}
   const sorted=[...gaps].sort((a,b)=>a-b);resolve({frames:gaps.length,p95Ms:sorted[Math.floor(sorted.length*.95)]??Infinity,longFrameFraction:gaps.filter(gap=>gap>100).length/Math.max(1,gaps.length)});
  }requestAnimationFrame(frame);
 }));
 expect(metrics.frames).toBeGreaterThan(15);expect(metrics.p95Ms).toBeLessThan(150);expect(metrics.longFrameFraction).toBeLessThan(.25);
 await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.halo-env[data-moving=true]')).toHaveCount(0);
 await info.attach('animation-metrics',{body:JSON.stringify({metrics,budgets:{p95Ms:150,longFrameFraction:.25},scope:'Two-second local Chromium regression sample, not a mobile battery, GPU or field frame-rate certification.'}),contentType:'application/json'});
});
