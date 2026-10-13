import {expect,test} from '@playwright/test';
import {mockProduction,homeId} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {emptyTest,type TestRecord} from '../../lib/frontend/home-test-preview';

const owned:TestRecord={...emptyTest('private-test'),title:'Private kitchen tap record',purpose:'Keep my original report',contextId:homeId,contextSnapshot:{label:'Current home',revision:1},medium:'water',revision:4};
test('malformed test rows show a recoverable load error without a crash or fixture substitution',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await mockProduction(page,{'/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='tests'?[{...owned,rows:null}]:[],revision:1,complete:true,pendingOperations:[]})});
 await page.goto('/home?destination=tests');await expect(page.getByRole('alert').filter({hasText:'The records could not be read.'})).toBeVisible();await expect(page.locator('body')).not.toContainText('Lower-level radon test');expect(errors).toEqual([]);
});
test('private test deletion uses the captured revision and unknown status can be checked inside its modal',async({page})=>{
 let records:TestRecord[]=[owned],writes=0,id='';
 const network=await mockProduction(page,{
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='tests'?records:[],revision:1,complete:true,pendingOperations:[]}),
  '/api/frontend/workspace/commands':async route=>{const command=route.request().postDataJSON();writes++;id=command.operationId;expect(command.kind).toBe('remove');expect(command.recordId).toBe(owned.id);expect(command.expectedRevision).toBe(4);await route.abort('failed');},
  '/api/operations':async(route,url)=>{expect(url.searchParams.get('operationId')).toBe(id);expect(url.searchParams.get('domain')).toBe('workspace');records=[];await jsonRoute(route,{operationId:id,status:'succeeded',changes:{tests:[]},revisions:{tests:2}});},
 });
 await page.goto('/home?destination=tests');await page.getByRole('button',{name:`Delete ${owned.title}`,exact:true}).click();const modal=page.getByRole('dialog');await modal.getByRole('button',{name:'Yes, delete',exact:true}).click();
 await expect(modal.getByRole('button',{name:'Check save status',exact:true})).toBeVisible();await expect(modal.getByRole('button',{name:'Yes, delete',exact:true})).toBeDisabled();expect(writes).toBe(1);
 await modal.getByRole('button',{name:'Check save status',exact:true}).click();await expect(modal).toHaveCount(0);await expect(page.getByRole('button',{name:`Delete ${owned.title}`,exact:true})).toHaveCount(0);expect(writes).toBe(1);expect(network.blocked).toEqual([]);
});
test('food topic preferences are explicit, canonical and survive reload without rewriting tasks',async({page})=>{
 let preferences:Record<string,unknown>={'food-interests':[]},writes=0;
 const network=await mockProduction(page,{
  '/api/frontend/actions':route=>jsonRoute(route,{actions:[],metas:{},preferences,unresolvedOperations:[]}),
  '/api/frontend/actions/commands':async route=>{writes++;const command=route.request().postDataJSON();expect(command.kind).toBe('revise');expect(command.changes).toEqual([]);preferences=command.preferences;await jsonRoute(route,{operationId:command.operationId,status:'succeeded',snapshot:{actions:[],metas:{},preferences,unresolvedOperations:[]}});},
 });
 await page.goto('/home?destination=food');await page.getByText('Arrange your topics',{exact:true}).click();const topics=page.locator('details').filter({has:page.getByText('Arrange your topics',{exact:true})});const fish=topics.getByRole('button',{name:'Fish advisories',exact:true});await fish.click();expect(writes).toBe(0);await topics.getByRole('button',{name:'Cancel',exact:true}).click();await expect(fish).toHaveAttribute('aria-pressed','false');
 await fish.click();await topics.getByRole('button',{name:'Save topics',exact:true}).click();await expect(topics.getByRole('button',{name:'Save topics',exact:true})).toHaveCount(0);expect(writes).toBe(1);
 await page.reload();await page.getByText('Arrange your topics',{exact:true}).click();await expect(page.locator('details').filter({has:page.getByText('Arrange your topics',{exact:true})}).getByRole('button',{name:'Fish advisories',exact:true})).toHaveAttribute('aria-pressed','true');expect(writes).toBe(1);expect(network.blocked).toEqual([]);
});
test('account recovery enrollment stays pending until a verified server snapshot arrives',async({page})=>{
 const base={feature:'recovery',revision:1,enabled:true,unresolvedOperations:[],recovery:{method:null,challenge:null,devices:[]}};let current:unknown=base,writes=0;
 const network=await mockProduction(page,{
  '/api/account':route=>jsonRoute(route,current),
  '/api/account/commands':async route=>{const command=route.request().postDataJSON();writes++;expect(command.feature).toBe('recovery');expect(route.request().headers()['if-match']).toBe(String(writes));current=command.action==='request-recovery'?{...base,revision:2,recovery:{...base.recovery,challenge:{id:'challenge',maskedAddress:'u***@example.com',expiresAt:'2099-01-01T00:00:00Z',status:'pending'}}}:{...base,revision:3,recovery:{...base.recovery,method:{id:'method',maskedAddress:'u***@example.com',verifiedAt:'2026-10-13T12:00:00Z'}}};await jsonRoute(route,{operationId:command.operationId,status:'succeeded',snapshot:current});},
 });
 await page.goto('/settings?open=privacy');await page.getByText('Recovery & devices',{exact:true}).click();await page.getByLabel('Recovery email',{exact:true}).fill('user@example.com');await page.getByRole('button',{name:'Request verification',exact:true}).click();await expect(page.getByText('Verification is pending. Open the ownership-verification message, then check again.',{exact:true})).toBeVisible();await expect(page.getByText('Recovery method verified',{exact:true})).toHaveCount(0);expect(writes).toBe(1);
 await page.getByRole('button',{name:'Check verification',exact:true}).click();await expect(page.getByText('Recovery method verified',{exact:true})).toBeVisible();expect(writes).toBe(2);expect(network.blocked).toEqual([]);
});
test('saved summary opens the server-frozen snapshot, not the current home records',async({page})=>{
 const archive={id:'archive-1',revision:1,title:'October private summary',createdAt:'2026-10-13T12:00:00Z',homeContextId:homeId};const snapshot={...archive,report:{title:archive.title,generated:archive.createdAt,introduction:['Saved evidence context'],sections:[{title:'Original test',lines:['Frozen source revision four.']}]},selection:{purpose:'Household review',start:'2026-10-01',end:'2026-10-13',sections:{scores:false,factors:false,tests:true,actions:false,maintenance:false,observations:false,gardens:false},categories:false,location:false,notes:false,attachments:false,appendix:false,excluded:[]},manifest:[{kind:'tests',id:owned.id,revision:4,asOf:null}],omissions:[]};
 const network=await mockProduction(page,{'/api/summaries':route=>jsonRoute(route,{items:[archive],complete:true,unresolvedOperations:[]}),'/api/summaries/detail':route=>jsonRoute(route,snapshot),'/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='tests'?[{...owned,title:'Newer test title',revision:8}]:[],revision:8,complete:true,pendingOperations:[]})});
 await page.goto('/home?destination=summary');await page.getByText('Saved summaries · 1',{exact:true}).click();await page.getByRole('button',{name:/October private summary/}).click();await page.getByText('Review included information',{exact:true}).click();await expect(page.getByText('Frozen source revision four.',{exact:true})).toBeVisible();await expect(page.locator('.hg-summary-preview')).not.toContainText('Newer test title');expect(network.requests.filter(item=>item.path==='/api/summaries'&&item.method==='POST')).toHaveLength(0);expect(network.blocked).toEqual([]);
});
