import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});});

for(const appearance of ['light','dark'])test(`shared surfaces keep readable ${appearance} typography and fit narrow large text`,async({page},info)=>{
  test.setTimeout(120000);
  const routes=[['today','tab=today'],['home','tab=home'],['explore','tab=act'],['tests','tab=home&destination=tests'],['care','tab=home&destination=maintenance'],['food','tab=home&destination=food'],['summary','tab=home&destination=summary'],['map','map']];
  for(const [name,query]of routes){
    for(const [width,scale]of [[390,100],[320,150]]){
      await page.setViewportSize({width,height:850});
      await page.goto(`/foundation/preview/${query==='map'?'map/':'expanded/'}?${query==='map'?'edition=expanded':query}&appearance=${appearance}&scale=${scale}&motion=reduce`);
      const app=page.locator('.halo-f-app');await expect(app).toBeVisible();
      await expect(app).toHaveAttribute('data-text-scale',String(scale));
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} at ${width}`).toBe(true);
      const fonts=await app.locator('h1,h2,h3').evaluateAll(elements=>elements.map(el=>getComputedStyle(el).fontFamily));
      expect(fonts.every(font=>!/fraunces|georgia/i.test(font)),`${name} uses HALO sans headings`).toBe(true);
      expect(await app.evaluate(el=>getComputedStyle(el).colorScheme)).toBe(appearance);
      if(width===390)await page.screenshot({path:info.outputPath(`${name}-${appearance}.png`),fullPage:true});
    }
  }
});

test('home workspace add menu opens a real entry and dismisses predictably by keyboard',async({page})=>{
  await page.goto('/foundation/preview/expanded/?tab=home&motion=reduce');
  const menu=page.locator('.how-add-menu');const toggle=menu.locator('summary');
  await toggle.focus();await page.keyboard.press('Enter');
  await expect(menu).toHaveAttribute('open','');
  await page.keyboard.press('Escape');await expect(menu).not.toHaveAttribute('open','');await expect(toggle).toBeFocused();
  await toggle.click();await menu.getByRole('link',{name:'Plan a test',exact:true}).click();
  await expect(page).toHaveURL(/homeView=new/);await expect(page.locator('.hg-form')).toBeVisible();
});
