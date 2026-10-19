import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});});

for(const tab of ['today','home'])test(`${tab} score arc fills to its value while outer factors match the legend`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.goto(`/foundation/preview/expanded/?tab=${tab}&motion=full&appearance=dark`);
  const ring=page.locator('.halo-score-orbit');const arc=ring.locator('.halo-score-orbit-value');
  await expect(ring).toBeVisible();
  await page.waitForFunction(()=>{const animation=document.querySelector('.halo-score-orbit-value')?.getAnimations()[0];if(!animation)return false;animation.pause();return true;});
  const frames=await arc.evaluate(el=>{const a=el.getAnimations()[0];a.pause();a.currentTime=0;const start=getComputedStyle(el).strokeDasharray;a.currentTime=500;const middle=getComputedStyle(el).strokeDasharray;const frames=(a.effect as KeyframeEffect).getKeyframes();a.finish();return {start,middle,frames};});
  expect(Number.parseFloat(frames.start)).toBe(0);
  const target=tab==='home'?58:74;
  expect(Number.parseFloat(frames.middle)).toBeGreaterThan(0);expect(Number.parseFloat(frames.middle)).toBeLessThan(target);
  await expect(arc).toHaveAttribute('stroke-dasharray',`${target} ${100-target}`);
  expect(String(frames.frames.at(-1)?.strokeDasharray).split(/[,\s]+/).map(Number)).toEqual([target,100-target]);
  const shares=await ring.locator('.halo-score-orbit-share').evaluateAll(nodes=>nodes.map(n=>Number(n.getAttribute('data-share'))));
  const legend=await page.locator('.halo-ph-contribution-track > span').evaluateAll(nodes=>nodes.map(n=>Number.parseFloat((n as HTMLElement).style.width)));
  expect(shares).toHaveLength(tab==='home'?2:4);shares.forEach((value,i)=>expect(value).toBeCloseTo(legend[i],3));
  expect(shares.reduce((a,b)=>a+b,0)).toBeCloseTo(100,5);
  await expect(ring).toHaveAttribute('aria-label',/Outer ring shows risk shares, not score points/);
  await page.getByRole('link',{name:tab==='home'?'PFAS, 75% of risk. Open factor page.':'Air, 19.4% of risk. Open factor page.',exact:true}).click();
  await expect(page).toHaveURL(/factor\//);
});

test('reduced motion and changing device preference show the final ring immediately',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/foundation/preview/expanded/?tab=home&motion=full');
  const arc=page.locator('.halo-score-orbit-value');await expect(arc).toHaveAttribute('stroke-dasharray','58 42');
  expect(await arc.evaluate(el=>el.getAnimations().length)).toBe(0);
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>Boolean(document.querySelector('.halo-score-orbit-value')?.getAnimations().length));
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect.poll(()=>arc.evaluate(el=>el.getAnimations().length)).toBe(0);
  expect(Number.parseFloat(await arc.evaluate(el=>getComputedStyle(el).strokeDasharray))).toBe(58);
});

for(const scenario of ['no-data','score-zero','score-full','partial','contribution-single','contribution-sliver'])test(`score ring preserves ${scenario} evidence`,async({page})=>{
  await page.goto(`/foundation/preview/expanded/?tab=today&scenario=${scenario}&motion=reduce`);
  const ring=page.locator('.halo-score-orbit');await expect(ring).toBeVisible();
  if(scenario==='no-data'){await expect(ring).toHaveAttribute('data-empty','true');await expect(ring.locator('.halo-score-orbit-share')).toHaveCount(0);}
  if(scenario==='score-zero'){await expect(ring).toHaveAttribute('data-empty','false');await expect(ring.locator('.halo-score-orbit-value')).toHaveCount(0);}
  if(scenario==='score-full'){await expect(ring.locator('.halo-score-orbit-value')).toHaveAttribute('stroke-dasharray','100 0');await expect(ring.locator('.halo-score-orbit-share')).toHaveCount(0);}
  if(scenario==='partial'){await expect(ring).toHaveAttribute('data-partial','true');await expect(ring.locator('[data-factor=pollen]')).toHaveCount(0);await expect(ring).toHaveAttribute('aria-label',/Pollen: unavailable/);}
  if(scenario==='contribution-single')await expect(ring.locator('.halo-score-orbit-share')).toHaveCount(1);
  if(scenario==='contribution-sliver')await expect(ring.locator('[data-factor=uv]')).toHaveAttribute('data-share','5');
});

test('forced colors keeps static readable score and text percentages',async({page})=>{
  await page.emulateMedia({forcedColors:'active',reducedMotion:'no-preference'});
  await page.goto('/foundation/preview/expanded/?tab=home&motion=full&contrast=true&scale=150');
  await expect(page.locator('.halo-score-orbit')).toBeVisible();
  expect(await page.locator('.halo-score-orbit-value').evaluate(el=>el.getAnimations().length)).toBe(0);
  await expect(page.locator('.halo-ph-legend')).toContainText('PFAS75%');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
