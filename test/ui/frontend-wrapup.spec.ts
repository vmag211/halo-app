import {test, expect, type Page} from '@playwright/test';

const root='/foundation/preview/expanded/?motion=reduce';
test.beforeEach(async({page})=>{
  await page.route('**/*',route=>{
    const url=new URL(route.request().url());
    return ['127.0.0.1','localhost'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();
  });
});
async function fits(page:Page){
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const app=page.getByTestId('foundation-product');
  expect(await app.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
}
for(const width of [320,375,1280])test(`Explore resources stays inside the app at enlarged text, ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:800});
  await page.goto(root+'&tab=act&destination=projects&scale=150&appearance=light');
  const trigger=page.getByLabel('Explore resources',{exact:true});
  const menu=page.locator('.ex-resource-menu');
  await expect(menu).toBeHidden();
  await trigger.click();await expect(menu).toBeVisible();
  const app=await page.getByTestId('foundation-product').boundingBox();const bounds=await menu.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(app!.x);
  expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(app!.x+app!.width);
  await page.screenshot({path:info.outputPath('resources.png')});
  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(trigger).toBeFocused();await fits(page);
});
test('Homeguard entry retains visible return and workspace controls, including switching sections',async({page})=>{
  await page.setViewportSize({width:320,height:760});
  await page.goto(root+'&tab=home&destination=tests&scale=150');
  const nav=page.locator('.hg-workspace-nav');const selector=page.getByRole('combobox',{name:'Home workspace',exact:true});
  for(const section of ['tests','maintenance','food','summary']){
    if(section!=='tests')await selector.selectOption(section);
    await expect(page.locator('.hg-workspace')).toHaveAttribute('data-home-section',section);
    await expect.poll(async()=>{const n=await nav.boundingBox();const h=await page.locator('.halo-f-header').boundingBox();return n!.y>=h!.y+h!.height-1&&n!.y+n!.height<760;}).toBe(true);
    await fits(page);
  }
});
test('Journal remembered-day actions and checkboxes are usable without a pointer',async({page})=>{
  await page.goto(root+'&tab=plan&destination=journal');
  await expect(page.getByRole('heading',{name:'Recent check-ins'})).toHaveCount(0);
  await page.getByText('New here? Remember earlier days',{exact:true}).click();
  for(const name of ['Save remembered days','Log today instead']){
    const box=await page.getByRole('button',{name,exact:true}).boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  const check=page.getByLabel('Possibly an illness',{exact:true});
  expect((await check.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await check.focus();await page.keyboard.press('Space');await expect(check).toBeChecked();
  await page.getByRole('button',{name:'Felt fine',exact:true}).click();
  await page.getByRole('button',{name:'Save check-in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Recent check-ins'})).toBeVisible();
});
test('Outdoor source actions remain separate full-sized targets at narrow large text',async({page})=>{
  await page.setViewportSize({width:320,height:760});
  await page.goto(root+'&tab=plan&destination=outdoors&scale=150');
  await page.getByText('Forecast coverage',{exact:true}).click();
  const weather=await page.getByRole('link',{name:'Check official weather',exact:true}).boundingBox();
  const air=await page.getByRole('link',{name:'Check AirNow',exact:true}).boundingBox();
  expect(weather!.height).toBeGreaterThanOrEqual(44);expect(air!.height).toBeGreaterThanOrEqual(44);
  expect(air!.y).toBeGreaterThanOrEqual(weather!.y+weather!.height);
  await fits(page);
});
for(const [width,scale,appearance] of [[320,150,'light'],[375,100,'dark'],[430,130,'light'],[1280,100,'dark']] as const){
  test(`Connected layout sweep ${width}px ${scale}% ${appearance}`,async({page})=>{
    test.setTimeout(120000);await page.setViewportSize({width,height:850});
    const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
    const routes=[...['plan','today','home','act','settings'].map(tab=>`tab=${tab}`),
      ...['tests','maintenance','food','summary'].map(destination=>`tab=home&destination=${destination}`),
      ...['projects','opportunities','community','observations','outreach'].map(destination=>`tab=act&destination=${destination}`),
      ...['journal','patterns','recap','outdoors'].map(destination=>`tab=plan&destination=${destination}`),
      ...['pantry','garden','fish','growers','evidence','water'].map(view=>`tab=home&destination=food&homeView=${view}`)];
    for(const query of routes){
      await page.goto(`${root}&appearance=${appearance}&scale=${scale}&${query}`);
      await expect(page.getByTestId('foundation-product')).toBeVisible();
      await expect(page.getByTestId('foundation-product')).not.toContainText('This destination is unavailable');
      await page.evaluate(()=>document.fonts.ready);await fits(page);
      const shellWidth=(await page.getByTestId('foundation-product').boundingBox())!.width;
      expect(shellWidth).toBeLessThanOrEqual(width>=1024?1440:width>=768?720:430);
      if(width>=1024){expect(shellWidth).toBeGreaterThan(720);await expect(page.locator('.halo-app-sidebar')).toBeVisible();}
    }
    expect(errors).toEqual([]);
  });
}
