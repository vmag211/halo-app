import {test,expect,type Page} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

const caps={available:true,providerLabel:'Configured assistant',retentionSummary:'Conversation retention follows your account policy.',publicRetrieval:true,context:{tasks:true,home:false,projects:true},tools:['tasks.create']};
const empty=()=>({id:'conversation1',revision:1,messages:[] as unknown[],pendingRequest:null,unresolvedOperations:{}});
async function openLuna(page:Page,path='/today'){
 await page.goto(path);await page.getByRole('button',{name:/^(Ask|Open) Luna$/}).click();
 const panel=page.getByRole('dialog',{name:'Luna',exact:true});await expect(panel).toBeVisible();
 await expect(panel.getByRole('button',{name:'Find local ways to volunteer'})).toBeEnabled();return panel;
}

test('production Luna works on Settings with explicit page context and canonical conversation persistence',async({page})=>{
 let saved=empty();
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,saved),
  '/api/luna/messages':async route=>{const request=route.request().postDataJSON();expect(request.page).toBe('Settings');expect(request.noteContext).toEqual([]);expect(request).not.toHaveProperty('household');expect(request).not.toHaveProperty('journal');saved={...saved,revision:2,messages:[{id:'reply',role:'assistant',text:'Your choices are managed in Settings.'}]};await jsonRoute(route,{id:'run1',status:'completed',conversation:saved});},
 });
 const panel=await openLuna(page,'/settings');await panel.getByLabel('Message Luna').fill('Where can I change appearance?');await panel.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(panel.getByRole('log')).toContainText('Your choices are managed in Settings.');await panel.getByRole('button',{name:'Close sheet',exact:true}).click();
 await page.getByRole('button',{name:/^(Ask|Open) Luna$/}).click();await expect(page.getByRole('log')).toContainText('Your choices are managed in Settings.');
 expect(await page.evaluate(()=>Object.values(localStorage).some(value=>value.includes('Where can I change appearance?')))).toBe(false);expect(network.blocked).toEqual([]);
});

test('source-backed replies render as text, unsafe URLs are rejected, and privacy uses actual capabilities',async({page})=>{
 let posted=0;
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,empty()),
  '/api/luna/messages':async route=>{posted++;await jsonRoute(route,{id:`run${posted}`,status:'completed',conversation:{...empty(),revision:posted+1,messages:[{id:'reply',role:'assistant',text:'Outdoor air is context\u2014not an individual exposure test. <script>unsafe</script>',sources:[{title:'EPA\u2014air information',url:posted===1?'https://www.epa.gov/air-research':'javascript:alert(1)'}]}]}});},
 });
 const panel=await openLuna(page);await panel.getByRole('button',{name:'Context & privacy'}).click();await expect(panel).toContainText('Tasks on, home records off, projects on.');await expect(panel).toContainText('Journal text and private task preparation stay excluded.');await expect(panel).toContainText(caps.retentionSummary);
 await panel.getByLabel('Message Luna').fill('Explain the available readings.');await panel.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(panel.getByRole('log')).toContainText('Outdoor air is context,not an individual exposure test. <script>unsafe</script>');await expect(panel.locator('script')).toHaveCount(0);await panel.getByText('Sources and scope',{exact:true}).click();await expect(panel.getByRole('link',{name:'EPA,air information'})).toHaveAttribute('href','https://www.epa.gov/air-research');await expect(panel).not.toContainText('\u2014');
 await panel.getByLabel('Message Luna').fill('Check another source.');await panel.getByRole('button',{name:'Send message',exact:true}).click();await expect(panel.getByRole('button',{name:'Check existing request'})).toBeVisible();await expect(panel.locator('a[href^="javascript:"]')).toHaveCount(0);await expect(panel.getByRole('log')).toContainText('Outdoor air is context');expect(posted).toBe(2);expect(network.blocked).toEqual([]);
});

test('failed, refused and ungrounded service outcomes remain distinct without fabricated advice',async({page})=>{
 let message=0;
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,empty()),
  '/api/luna/messages':async route=>{message++;if(message===1){await jsonRoute(route,{id:'run1',status:'failed',message:'Sources are unavailable. Your question is kept.'});return;}if(message===4){await jsonRoute(route,{error:'private database details'},429);return;}const text=message===2?'I cannot diagnose or recommend treatment.':'No reliable source is available for this question.';await jsonRoute(route,{id:`run${message}`,status:'completed',conversation:{...empty(),revision:message+1,messages:[{id:`reply${message}`,role:'assistant',text}]}});},
 });
 const panel=await openLuna(page,'/home');const input=panel.getByLabel('Message Luna');const send=async(text:string)=>{await input.fill(text);await panel.getByRole('button',{name:'Send message',exact:true}).click();};
 await send('Explain the available sources.');await expect(panel).toContainText('Sources are unavailable. Your question is kept.');await expect(input).toHaveValue('Explain the available sources.');
 await send('Can you diagnose this?');await expect(panel.getByRole('log')).toContainText('I cannot diagnose or recommend treatment.');
 await send('Find an unsupported answer.');await expect(panel.getByRole('log')).toContainText('No reliable source is available for this question.');
 await send('Trigger a request limit.');await expect(panel).not.toContainText('private database details');await expect(input).toHaveValue('Trigger a request limit.');await expect(panel.getByRole('button',{name:'Check existing request'})).toBeVisible();expect(network.blocked).toEqual([]);
});

test('pending questions cancel through the service and late answers never replace the retained draft',async({page})=>{
 let release!:()=>void,requestId='',cancels=0;
 const held=new Promise<void>(resolve=>{release=resolve;});
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,empty()),
  '/api/luna/messages':async route=>{requestId=route.request().headers()['idempotency-key'];await held;await jsonRoute(route,{id:'late',status:'completed',conversation:{...empty(),revision:2,messages:[{id:'late',role:'assistant',text:'Late response that must not appear.'}]}}).catch(()=>{});},
  '/api/luna/runs/cancel':async route=>{cancels++;expect(route.request().postDataJSON().id).toBe(requestId);await jsonRoute(route,{id:requestId,status:'cancelled'});},
 });
 const panel=await openLuna(page);const input=panel.getByLabel('Message Luna');await input.fill('Keep my cancelled draft.');await input.press('Enter');await expect.poll(()=>requestId).not.toBe('');await expect(panel.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'Cancel request',exact:true}).click();await expect(panel).toContainText('Request stopped. Your question is kept.');await expect(input).toHaveValue('Keep my cancelled draft.');release();await expect(panel).not.toContainText('Late response that must not appear.');expect(cancels).toBe(1);expect(network.blocked).toEqual([]);
});

test('closing an uncertain request retains its identity and checks it without another message POST',async({page})=>{
 let posts=0,operation='';
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,empty()),
  '/api/luna/messages':async route=>{posts++;operation=route.request().headers()['idempotency-key'];await route.abort('failed');},
  '/api/luna/runs/status':async(route,url)=>{expect(url.searchParams.get('id')).toBe(operation);await jsonRoute(route,{id:operation,status:'failed',message:'No answer was generated. Your question is kept.'});},
 });
 const panel=await openLuna(page);await panel.getByLabel('Message Luna').fill('Keep this question if the network drops.');await panel.getByRole('button',{name:'Send message',exact:true}).click();await expect(panel.getByRole('button',{name:'Check existing request'})).toBeVisible();await panel.getByRole('button',{name:'Close sheet',exact:true}).click();await page.getByRole('button',{name:/^(Ask|Open) Luna$/}).click();await expect(panel.getByLabel('Message Luna')).toHaveValue('Keep this question if the network drops.');await panel.getByRole('button',{name:'Check existing request'}).click();await expect(panel).toContainText('No answer was generated. Your question is kept.');expect(posts).toBe(1);expect(network.blocked).toEqual([]);
});

test('conversation clearing is revision-bound and only acknowledged by an empty canonical receipt',async({page})=>{
 const initial={...empty(),revision:7,messages:[{id:'old',role:'assistant',text:'Saved conversation message.'}]};let clears=0;
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,initial),
  '/api/luna/conversations/clear':async route=>{clears++;expect(route.request().postDataJSON()).toEqual({id:'conversation1',revision:7});expect(route.request().headers()['x-halo-if-match']).toBe('7');await jsonRoute(route,{...empty(),revision:8});},
 });
 await page.goto('/plan');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();const panel=page.getByRole('dialog',{name:'Luna',exact:true});await expect(panel.getByRole('log')).toContainText('Saved conversation message.');await panel.getByRole('button',{name:'New conversation',exact:true}).click();expect(clears).toBe(0);await panel.getByRole('button',{name:'Clear conversation',exact:true}).click();await expect(panel.getByRole('log')).not.toContainText('Saved conversation message.');await expect(panel.getByText('Conversation cleared. Saved app records were kept.',{exact:true})).toHaveCount(1);expect(clears).toBe(1);expect(network.blocked).toEqual([]);
});

test('identity changes clear private drafts and ignore a late response from the previous session',async({page})=>{
 let release!:()=>void,posted=false;const held=new Promise<void>(resolve=>{release=resolve;});
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,empty()),
  '/api/luna/messages':async route=>{posted=true;await held;await jsonRoute(route,{id:'late',status:'completed',conversation:{...empty(),revision:2,messages:[{id:'old',role:'assistant',text:'Previous household response.'}]}}).catch(()=>{});},
 });
 const panel=await openLuna(page);await panel.getByLabel('Message Luna').fill('A private draft.');await panel.getByRole('button',{name:'Send message',exact:true}).click();await expect.poll(()=>posted).toBe(true);await page.evaluate(()=>window.dispatchEvent(new Event('halo:identity-changed')));release();await expect(page.getByRole('dialog',{name:'Luna',exact:true})).toHaveCount(0);await expect(page.locator('body')).not.toContainText('Previous household response.');await expect(page.locator('body')).not.toContainText('A private draft.');expect(network.blocked).toEqual([]);
});
