import {test,expect} from '@playwright/test';
import {jsonRoute,stageProfile} from './stage-fixtures';
import {mockProduction,settingsSnapshot,homeId} from './production-fixtures';

const unavailableHome={feature:'home',revision:1,enabled:false,reason:'Location search is unavailable.',unresolvedOperations:[],home:{current:null,candidates:[],portableTasks:[],history:[],review:null}};
test('Settings section links honor valid intent without hydration errors or writes',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/hydrat|server rendered/i.test(message.text()))errors.push(message.text());});
 const network=await mockProduction(page,{'/api/account':route=>jsonRoute(route,unavailableHome)});
 for(const intent of ['home','household','unrecognized']){
  await page.goto(`/settings?open=${intent}`);
  if(intent==='unrecognized')await expect(page.locator('[data-setting-panel="home"]')).toBeVisible();
  else {await expect(page.getByRole('combobox',{name:'Water source',exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:'Toddlers',exact:true})).toBeVisible();}
 }
 expect(errors).toEqual([]);expect(network.requests.filter(request=>['PUT','PATCH','POST','DELETE'].includes(request.method))).toEqual([]);expect(network.blocked).toEqual([]);
});
test('household saves all seven flags, preserves an explicitly rebased untouched answer and blocks overlap',async({page})=>{
 const profile=structuredClone(stageProfile);let settings=structuredClone(settingsSnapshot),writes=0,profileReads=0;let release:()=>void=()=>{};let body:Record<string,unknown>|null=null;
 const network=await mockProduction(page,{
  '/api/profile':route=>{profileReads++;return jsonRoute(route,{...profile,home_context:{id:homeId,revision:1},profile:{...profile.profile,home_context_id:homeId}});},
  '/api/account':route=>jsonRoute(route,unavailableHome),
  '/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,settings);return;}writes++;body=route.request().postDataJSON();await new Promise<void>(resolve=>{release=resolve;});const input=body!;profile.household=input.household as typeof profile.household;settings={...settings,revision:settings.revision+1,values:input.values as typeof settings.values};await jsonRoute(route,{operationId:input.operationId,status:'succeeded',snapshot:settings});},
 });
 await page.goto('/settings?open=home');const toddler=page.getByRole('checkbox',{name:'Toddlers',exact:true});await expect(toddler).not.toBeChecked();await toddler.check();
 profile.household.has_senior=true;await page.evaluate(()=>window.dispatchEvent(new Event('halo:settings-changed')));await expect.poll(()=>profileReads).toBeGreaterThan(1);await expect(page.getByRole('checkbox',{name:'Older adults',exact:true})).not.toBeChecked();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('button',{name:'Review latest values',exact:true})).toBeVisible();expect(writes).toBe(0);await page.getByRole('button',{name:'Review latest values',exact:true}).click();await expect(page.getByRole('checkbox',{name:'Older adults',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect.poll(()=>writes).toBe(1);await expect(toddler).toBeDisabled();await expect(page.getByRole('button',{name:'Save changes',exact:true})).toBeDisabled();
 expect(body!.household).toEqual({has_toddler:true,has_child:true,has_teen:false,has_adult:true,has_senior:true,has_pregnant:false,has_respiratory:false});release();await expect(page.getByText('Changes saved.',{exact:true})).toBeVisible();await expect(toddler).toBeChecked();expect(network.blocked).toEqual([]);
});
test('invalid home input and failed saves retain the draft; retry sends canonical fields',async({page})=>{
 let saves=0,current=structuredClone(settingsSnapshot);const bodies:unknown[]=[];
 const network=await mockProduction(page,{'/api/account':route=>jsonRoute(route,unavailableHome),'/api/settings':async route=>{
  if(route.request().method()==='GET'){await jsonRoute(route,current);return;}saves++;const input=route.request().postDataJSON();bodies.push(input.values.home);if(saves===1){await jsonRoute(route,{operationId:input.operationId,status:'failed',message:'private server diagnostic'});return;}current={...current,revision:current.revision+1,values:input.values};await jsonRoute(route,{operationId:input.operationId,status:'succeeded',snapshot:current});
 }});
 await page.goto('/settings?open=home');const year=page.getByLabel('Building year (optional)',{exact:true});await year.fill('999');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Enter a four-digit past or current year, or leave it blank.',{exact:true})).toBeVisible();expect(saves).toBe(0);
 await year.fill('');await page.getByRole('combobox',{name:'Water source',exact:true}).selectOption('well');await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('The save was not applied. Your draft is still here.',{exact:true})).toBeVisible();await expect(year).toHaveValue('');await expect(page.getByRole('combobox',{name:'Water source',exact:true})).toHaveValue('well');await expect(page.locator('body')).not.toContainText('private server diagnostic');
 await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByText('Changes saved.',{exact:true})).toBeVisible();expect(bodies).toEqual([{year:'',water:'well',tenure:'renter'},{year:'',water:'well',tenure:'renter'}]);expect(network.blocked).toEqual([]);
});
test('opening home-location review preserves unsaved answers and never changes a home by itself',async({page})=>{
 const network=await mockProduction(page,{'/api/account':route=>jsonRoute(route,unavailableHome)});await page.goto('/settings?open=home');const toddler=page.getByRole('checkbox',{name:'Toddlers',exact:true});await toddler.check();await page.getByText('Home location',{exact:true}).click();await expect(page.getByLabel('City or ZIP code',{exact:true})).toBeVisible();await expect(toddler).toBeChecked();await expect(page).toHaveURL(/\/settings\?open=home$/);
 await page.getByRole('button',{name:'All settings',exact:true}).click();await page.locator('[data-setting-panel="home"]').click();await expect(toddler).toBeChecked();expect(network.requests.filter(request=>['PUT','PATCH','POST','DELETE'].includes(request.method))).toEqual([]);expect(network.blocked).toEqual([]);
});
test('unavailable settings cannot save and disconnect keeps a pending save unresolved until a status check',async({page})=>{
 let available=false,writes=0,operationId='';const network=await mockProduction(page,{'/api/account':route=>jsonRoute(route,unavailableHome),'/api/settings':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,available?settingsSnapshot:{error:'private unavailable details'},available?200:503);return;}writes++;operationId=route.request().postDataJSON().operationId;await route.abort('failed');},'/api/operations':(route,url)=>{expect(url.searchParams.get('operationId')).toBe(operationId);return jsonRoute(route,{operationId,status:'failed'});}});
 await page.goto('/settings?open=home');await expect(page.getByText('Settings could not load. Editing is unavailable.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);available=true;await page.getByRole('button',{name:'Try again',exact:true}).last().click();const toddler=page.getByRole('checkbox',{name:'Toddlers',exact:true});await toddler.check();await page.getByRole('button',{name:'Save changes',exact:true}).click();await expect(page.getByRole('button',{name:'Check save status',exact:true})).toBeVisible();await expect(toddler).toBeChecked();expect(writes).toBe(1);
 await page.getByRole('button',{name:'Save changes',exact:true}).click();expect(writes).toBe(1);await page.getByRole('button',{name:'Check save status',exact:true}).click();await expect(toddler).toBeChecked();expect(writes).toBe(1);expect(network.blocked).toEqual([]);
});
