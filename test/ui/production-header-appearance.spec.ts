import {expect,test,type Page} from '@playwright/test';
import {mockProduction,settingsSnapshot} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

/** Optional extra copy of the review screenshots, for a local run only. */
const shotDir=process.env.HALO_HEADER_SHOT_DIR;
async function shot(page:Page,name:string,info:import('@playwright/test').TestInfo){await page.screenshot({path:info.outputPath(name)});if(shotDir)await page.screenshot({path:`${shotDir}/${name}`});}

function savingSettings(){
 const state={current:structuredClone(settingsSnapshot) as typeof settingsSnapshot&{display:Record<string,unknown>},saves:[] as Record<string,unknown>[],matches:[] as (string|undefined)[]};
 const route=async(route:import('@playwright/test').Route)=>{
  if(route.request().method()==='GET'){await jsonRoute(route,state.current);return;}
  const input=route.request().postDataJSON();state.saves.push(input);state.matches.push(route.request().headers()['if-match']);
  expect(route.request().headers()['idempotency-key']).toBe(input.operationId);
  state.current={...state.current,revision:state.current.revision+1,values:input.values,display:input.display,calendar:input.calendar};
  await jsonRoute(route,{operationId:input.operationId,status:'succeeded',snapshot:state.current});
 };
 return {state,route};
}

for(const viewport of [{width:390,height:844,name:'phone'},{width:1440,height:900,name:'desktop'}]){
 test(`header appearance menu saves through settings and stays in the viewport (${viewport.name})`,async({page},info)=>{
  await page.setViewportSize(viewport);
  const settings=savingSettings();const network=await mockProduction(page,{'/api/settings':settings.route});
  await page.goto('/today');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
  const header=page.locator('.halo-f-header'),button=header.getByRole('button',{name:'Appearance',exact:true});
  await expect(header.getByRole('button',{name:'Settings',exact:true})).toBeVisible();
  const [a,b]=[await button.boundingBox(),await header.getByRole('button',{name:'Settings',exact:true}).boundingBox()];
  expect(a!.width).toBe(b!.width);expect(a!.height).toBe(b!.height);
  await button.click();
  const menu=page.getByRole('dialog',{name:'Appearance',exact:true});await expect(menu).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded','true');
  await expect(menu.getByRole('radio',{name:'Dark',exact:true})).toBeFocused();
  const box=(await menu.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await shot(page,`header-appearance-${viewport.name}-dark.png`,info);

  await menu.getByRole('radio',{name:'Light',exact:true}).check();
  await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','light');
  expect(settings.state.saves).toHaveLength(1);expect(settings.state.matches).toEqual(['1']);
  expect(settings.state.saves[0]).toMatchObject({group:'display',values:settingsSnapshot.values,calendar:settingsSnapshot.calendar,display:{appearance:'light',ambient:false,scale:'100',motion:'reduce',contrast:false,palette:'ocean'}});
  await expect(menu.getByRole('status')).toHaveText('Saved.');
  await menu.getByRole('radio',{name:'Forest',exact:true}).check();
  await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-palette','forest');
  expect(settings.state.matches).toEqual(['1','2']);
  await shot(page,`header-appearance-${viewport.name}-light.png`,info);

  await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(button).toBeFocused();
  await button.click();await expect(menu).toBeVisible();await page.mouse.click(5,viewport.height-5);await expect(menu).toBeHidden();
  // Settings reads the same canonical snapshot.
  await header.getByRole('button',{name:'Settings',exact:true}).click();await page.locator('[data-setting-panel="display"]').click();
  await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();await expect(page.getByRole('radio',{name:'Forest',exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
  await expect(page.locator('.halo-f-header').getByRole('button',{name:'Appearance',exact:true})).toHaveCount(0);
  expect(network.blocked).toEqual([]);
 });
}

test('a lost header save keeps the canonical appearance and offers a status check',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 let saves=0;const network=await mockProduction(page,{'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,settingsSnapshot);return;}saves++;await route.abort('failed');},'/api/operations':async route=>jsonRoute(route,{operationId:'none',status:'pending'})});
 await page.goto('/today');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await page.locator('.halo-f-header').getByRole('button',{name:'Appearance',exact:true}).click();
 const menu=page.getByRole('dialog',{name:'Appearance',exact:true});
 await menu.getByRole('radio',{name:'Light',exact:true}).check();
 await expect(menu.getByRole('button',{name:'Check save status',exact:true})).toBeVisible();
 await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await expect(menu.getByRole('radio',{name:'Dark',exact:true})).toBeChecked();
 // Until the lost save is reconciled, no further choice is sent.
 await expect(menu.getByRole('radio',{name:'Iris',exact:true})).toHaveAttribute('aria-disabled','true');
 await menu.getByRole('radio',{name:'Iris',exact:true}).check({force:true}).catch(()=>{});
 await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-palette','ocean');
 await expect(menu.getByRole('radio',{name:'Ocean',exact:true})).toBeChecked();
 expect(saves).toBe(1);expect(network.blocked).toEqual([]);
});
