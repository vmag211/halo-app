import {test,expect,type Locator} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{const url=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});
});

async function cameraRange(camera:Locator){
  return camera.evaluate(async node=>{
    const animation=node.getAnimations().find(a=>a instanceof CSSAnimation&&/^(halo-camera|mw-landscape-pan)$/.test(a.animationName))!;
    animation.pause();await animation.ready;
    const duration=Number(animation.effect?.getTiming().duration);
    animation.effect?.updateTiming({delay:0,fill:'both',direction:'normal',iterations:1});
    animation.currentTime=0;const start=new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
    animation.currentTime=duration;const end=new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
    return {duration,travel:Math.abs(end-start),width:node.getBoundingClientRect().width};
  });
}

for(const tab of ['today','home'])test(`${tab} panorama has a clear bounded sweep and retains pause`,async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto(`/app?tab=${tab}&motion=full`);
  const scene=page.locator('.halo-environment-scene .halo-env'),photo=scene.locator('.halo-env__photo');await expect(scene).toHaveAttribute('data-moving','true');
  const sweep=await cameraRange(photo);expect(sweep.duration).toBe(12000);expect(sweep.travel).toBeGreaterThan(sweep.width*.08);
  const frame=(await scene.boundingBox())!,art=(await photo.boundingBox())!;expect(art.x).toBeLessThanOrEqual(frame.x);expect(art.x+art.width).toBeGreaterThanOrEqual(frame.x+frame.width);
  await page.getByRole('button',{name:'Pause ambient animation',exact:true}).click();await expect(scene).toHaveAttribute('data-moving','false');await expect(photo).toHaveCSS('animation-play-state','paused');
});

test('all five week landscapes pan with their water overlay aligned and pause together',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/app?motion=full');
  const scene=page.locator('.mw-ambience');await expect(scene).toHaveAttribute('data-moving','true');
  for(const id of ['lake','coast','forest','meadow','cove']){
    if(id!=='lake')await scene.getByRole('button',{name:'Next landscape',exact:true}).click();
    await expect(scene).toHaveAttribute('data-scene',id);
    const layer=scene.locator(`[data-landscape=${id}]`),camera=layer.locator('.mw-ambience-panorama');
    await expect(layer.locator('img')).toHaveJSProperty('complete',true);await expect(camera).toHaveCSS('animation-play-state','running');
    const sweep=await cameraRange(camera);expect(sweep.duration).toBe(12000);expect(sweep.travel).toBeGreaterThan(sweep.width*.07);
    const art=(await layer.locator('img').boundingBox())!,water=(await layer.locator('canvas').boundingBox())!;
    expect(water.x).toBeCloseTo(art.x,0);expect(water.y).toBeCloseTo(art.y,0);expect(water.width).toBeCloseTo(art.width,0);expect(water.height).toBeCloseTo(art.height,0);
    const frame=(await scene.boundingBox())!;expect(art.x).toBeLessThanOrEqual(frame.x);expect(art.x+art.width).toBeGreaterThanOrEqual(frame.x+frame.width);
    await scene.getByRole('button',{name:'Pause landscape',exact:true}).click();await expect(camera).toHaveCSS('animation-play-state','paused');
    const frozen=await camera.evaluate(node=>getComputedStyle(node).transform);await page.waitForTimeout(100);expect(await camera.evaluate(node=>getComputedStyle(node).transform)).toBe(frozen);
    await scene.getByRole('button',{name:'Resume landscape',exact:true}).click();
  }
});

test('device reduction removes the week camera and keeps scene selection available',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/app?motion=full');
  await expect(page.locator('.mw-ambience-panorama')).toHaveCSS('animation-name','none');
  await page.getByRole('button',{name:'Next landscape',exact:true}).click();await expect(page.locator('.mw-ambience')).toHaveAttribute('data-scene','coast');
  await expect(page.locator('.mw-ambience-panorama')).toHaveCSS('transform','none');
});
