import {expect,test} from '@playwright/test';
import {mockProduction,settingsSnapshot,homeId} from './production-fixtures';
import {jsonRoute,stageProfile} from './stage-fixtures';

test('desktop settings section navigation returns to the index and retains unsaved drafts',async({page},info)=>{
 await page.setViewportSize({width:1280,height:900});
 const network=await mockProduction(page);
 await page.goto('/settings');await page.locator('[data-setting-panel="display"]').click();
 await page.getByRole('radio',{name:'Light',exact:true}).check();
 const sections=page.getByRole('navigation',{name:'Settings sections',exact:true});
 await sections.getByRole('button',{name:'Home & household',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Home & household',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'All settings',exact:true}).click();
 await expect(page.locator('[data-setting-panel="display"]')).toBeVisible();
 await page.locator('[data-setting-panel="display"]').click();
 await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
 await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await page.screenshot({path:info.outputPath('settings-desktop-draft.png'),fullPage:true});
 expect(network.requests.filter(request=>request.method!=='GET'&&request.path==='/api/settings')).toHaveLength(0);
 expect(network.blocked).toEqual([]);
});

test('direct settings panel links return to settings after desktop section switching',async({page})=>{
 await page.setViewportSize({width:1280,height:900});await mockProduction(page);
 await page.goto('/app/today');await expect(page.getByTestId('production-product')).toBeVisible();
 await page.goto('/app/settings?open=display');
 await page.getByRole('navigation',{name:'Settings sections',exact:true}).getByRole('button',{name:'Home & household',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Home & household',exact:true})).toBeVisible();
 await expect(page).toHaveURL(/open=home/);
 await page.getByRole('button',{name:'All settings',exact:true}).click();
 await expect(page.locator('[data-setting-panel="display"]')).toBeVisible();
 await expect(page).toHaveURL(/\/app\/settings(?:\?|$)/);
});

test('display edits apply only after canonical receipt and load unchanged on another visit',async({page})=>{
 let current=structuredClone(settingsSnapshot),saves=0;
 const network=await mockProduction(page,{'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,current);return;}saves++;const input=route.request().postDataJSON();expect(route.request().headers()['x-halo-if-match']).toBe(String(current.revision));expect(route.request().headers()['idempotency-key']).toBe(input.operationId);current={...current,revision:current.revision+1,values:input.values,display:input.display,calendar:input.calendar};await jsonRoute(route,{operationId:input.operationId,status:'succeeded',snapshot:current});}});
 await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');await page.locator('[data-setting-panel="display"]').click();
 await page.getByRole('radio',{name:'Light',exact:true}).check();await page.getByRole('radio',{name:'Forest',exact:true}).check();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-palette','ocean');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','light');await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-palette','forest');expect(saves).toBe(1);expect(current.display).toMatchObject({palette:'forest',appearance:'light'});
 await page.reload();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','light');await expect(page.getByTestId('foundation-product')).toHaveAttribute('data-palette','forest');await expect(page.getByRole('radio',{name:'Forest',exact:true})).toBeChecked();expect(saves).toBe(1);expect(network.blocked).toEqual([]);
});

test('unconfirmed settings save retains the choice and reconciles before any new mutation',async({page})=>{
 let saves=0,id='';const network=await mockProduction(page,{'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,settingsSnapshot);return;}saves++;id=route.request().postDataJSON().operationId;await route.abort('failed');},'/api/operations':async(route,url)=>{expect(url.searchParams.get('domain')).toBe('settings');expect(url.searchParams.get('operationId')).toBe(id);await jsonRoute(route,{operationId:id,status:'failed'});}});
 await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');await page.locator('[data-setting-panel="display"]').click();await page.getByRole('radio',{name:'Light',exact:true}).check();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check save status',exact:true})).toBeVisible();await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');expect(saves).toBe(1);
 await page.getByRole('button',{name:'Check save status',exact:true}).click();await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();expect(saves).toBe(1);expect(network.blocked).toEqual([]);
});

test('same-home profile rechecks preserve unrelated unsaved settings drafts',async({page})=>{
 let profileReads=0,settingsReads=0,release:()=>void=()=>{};
 const pending=new Promise<void>(resolve=>{release=resolve;});
 const network=await mockProduction(page,{
  '/api/profile':async route=>{profileReads++;if(profileReads>1)await pending;await jsonRoute(route,{...stageProfile,home_context:{id:homeId,revision:1},profile:{...stageProfile.profile,home_context_id:homeId}});},
  '/api/settings':async route=>{expect(route.request().method()).toBe('GET');settingsReads++;await jsonRoute(route,settingsSnapshot);},
 });
 await page.goto('/settings');await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');
 await page.locator('[data-setting-panel="display"]').click();await page.getByRole('radio',{name:'Light',exact:true}).check();
 await page.evaluate(()=>window.dispatchEvent(new Event('halo:settings-changed')));
 await expect.poll(()=>profileReads).toBe(2);await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
 release();await expect.poll(()=>network.requests.filter(request=>request.path==='/api/daily-score').length).toBe(2);await expect(page.getByRole('radio',{name:'Light',exact:true})).toBeChecked();
 await expect(page.locator('.halo-f-review')).toHaveAttribute('data-mode','dark');expect(settingsReads).toBe(1);expect(network.blocked).toEqual([]);
});

test('settings disclosures and connection rows keep their icons, labels and statuses in place',async({page})=>{
 await page.setViewportSize({width:375,height:812});const network=await mockProduction(page);
 // A direct link focuses the section heading for announcement without drawing a control outline.
 await page.goto('/app/settings?open=privacy');const heading=page.getByRole('heading',{name:'Privacy & data',exact:true});await expect(heading).toBeFocused();
 expect(await heading.evaluate(element=>getComputedStyle(element).outlineStyle)).toBe('none');
 // The Eye leads the label; only the trailing chevron moves to the edge and turns when opened.
 const summary=page.locator('summary',{hasText:'Inspect and export'});await expect(summary.locator('svg')).toHaveCount(2);
 const [eye,label]=[(await summary.locator('svg').first().boundingBox())!,(await summary.boundingBox())!];expect(eye.x-label.x).toBeLessThan(40);
 await summary.click();expect(await summary.locator('svg').first().evaluate(element=>getComputedStyle(element).transform)).toBe('none');
 // Connection name and status stack beside the icon instead of spreading to opposite edges.
 await page.goto('/app/settings?open=luna');await page.getByText('Connected services',{exact:true}).click();
 const email=page.getByRole('region',{name:'Email',exact:true}).locator('.hc-device');
 const [name,status]=[(await email.locator('strong').boundingBox())!,(await email.locator('small').boundingBox())!];
 expect(Math.abs(name.x-status.x)).toBeLessThan(2);expect(status.y).toBeGreaterThan(name.y);
 // Device steps name the button that exists.
 await page.goto('/app/settings?open=notifications');const setup=page.getByRole('button',{name:'Review device setup',exact:true});
 await expect(setup).toHaveAttribute('aria-expanded','false');await setup.click();await expect(setup).toHaveAttribute('aria-expanded','true');
 await expect(page.getByText('Choose Enable device notifications',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Enable device notifications',exact:true})).toBeVisible();
 expect(await page.locator('.hp-device-steps ol').evaluate(element=>getComputedStyle(element).listStyleType)).toBe('decimal');
 expect(network.blocked).toEqual([]);
});
