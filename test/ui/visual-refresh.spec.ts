import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.route('**/*',route=>{const url=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(url.hostname)&&!url.pathname.startsWith('/api/')?route.continue():route.abort();});});

for(const [palette,appearance,width]of [['forest','light',375],['forest','dark',1440],['iris','light',1440],['iris','dark',375]]as const)test(`${palette} ${appearance} fits ${width}px across the main screens`,async({page},info)=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:950});
 for(const tab of ['plan','today','home','act']){
  await page.goto(`/foundation/preview/expanded/?tab=${tab}&palette=${palette}&appearance=${appearance}&motion=reduce`);
  const app=page.getByTestId('foundation-product');await expect(app).toHaveAttribute('data-palette',palette);
  await expect(app).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(await app.evaluate(el=>getComputedStyle(el).colorScheme)).toBe(appearance);
  await page.screenshot({path:info.outputPath(`${tab}-${palette}-${appearance}-${width}.png`),fullPage:true});
 }
});

test('color theme is a retained draft with Save, Cancel and restore defaults',async({page})=>{
 await page.goto('/foundation/preview/expanded/?tab=settings&open=display&appearance=dark&motion=reduce');
 const app=page.getByTestId('foundation-product');await expect(app).toHaveAttribute('data-palette','ocean');
 await page.getByRole('radio',{name:'Forest',exact:true}).check();await expect(app).toHaveAttribute('data-palette','ocean');
 await page.getByRole('button',{name:'Cancel changes',exact:true}).click();await expect(page.getByRole('radio',{name:'Ocean',exact:true})).toBeChecked();
 await page.getByRole('radio',{name:'Iris',exact:true}).check();await page.getByRole('button',{name:'All settings',exact:true}).click();
 await page.getByRole('button',{name:/^Display & accessibility/}).click();await expect(page.getByRole('radio',{name:'Iris',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(app).toHaveAttribute('data-palette','iris');
 await page.getByRole('link',{name:'Homeguard',exact:true}).click();await expect(app).toHaveAttribute('data-palette','iris');
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/^Display & accessibility/}).click();
 await page.getByRole('combobox',{name:'Language preference',exact:true}).selectOption('es');await expect(page.getByText('Spanish is coming in a future update. HALO is available in English for now.')).toBeVisible();
 await page.getByRole('button',{name:'Restore display defaults',exact:true}).click();await expect(app).toHaveAttribute('data-palette','iris');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(app).toHaveAttribute('data-palette','ocean');
});

test('new themes and compact controls fit 320px enlarged contrast and forced colors',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:320,height:850});
 for(const tab of ['plan','home','settings&open=display']){
  await page.goto(`/foundation/preview/expanded/?tab=${tab}&palette=forest&appearance=light&contrast=true&scale=150&motion=reduce`);
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-contrast','high');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 await page.emulateMedia({forcedColors:'active'});
 await expect(page.getByRole('radio',{name:'Forest',exact:true})).toBeChecked();
 await page.getByRole('radio',{name:'Iris',exact:true}).check();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-palette','iris');
});
