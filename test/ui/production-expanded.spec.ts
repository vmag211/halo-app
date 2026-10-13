import {expect,test} from '@playwright/test';
import {mockProduction,homeId} from './production-fixtures';
import {jsonRoute,stageUserId} from './stage-fixtures';
const scope=`${stageUserId}:${homeId}:1`;
const area=(route:Parameters<typeof jsonRoute>[0])=>jsonRoute(route,{place:null,revision:1});
const caps={available:true,providerLabel:'Configured assistant',retentionSummary:'Your account policy',publicRetrieval:true,context:{tasks:true,home:false,projects:true},tools:['tasks.create']};

test('project generation is explicit, unknown results reconcile without a second generation request',async({page})=>{
 let posts=0,operation='';
 const network=await mockProduction(page,{'/api/explore/area':area,'/api/projects/generations/current':route=>jsonRoute(route,{data:null}),'/api/projects/generations':async route=>{posts++;operation=route.request().headers()['idempotency-key'];expect(route.request().postDataJSON().contextKey).toBe(scope);await route.abort('failed');},'/api/projects/generations/status':async(route,url)=>{expect(url.searchParams.get('id')).toBe(operation);await jsonRoute(route,{id:operation,status:'failed',contextKey:scope,message:'This request did not produce a project set.'});}});
 await page.goto('/act?view=main&destination=projects');
 await expect(page.getByRole('heading',{name:'Projects for you',exact:true})).toBeVisible();expect(posts).toBe(0);
 await page.getByLabel('What interests you right now?').fill('A balcony pollinator planter');
 await page.getByRole('button',{name:'Generate a few ideas'}).click();
 await expect(page.getByRole('button',{name:'Check existing generation'})).toBeVisible();expect(posts).toBe(1);
 await page.getByRole('button',{name:'Check existing generation'}).click();await expect(page.getByText('This request did not produce a project set.')).toBeVisible();expect(posts).toBe(1);
 await expect(page.locator('.ex-generated-item')).toHaveCount(0);expect(network.blocked).toEqual([]);
});

test('Luna displays only canonical service replies and action reviews require a separate confirmation',async({page})=>{
 let messages=0,confirms=0;const conversation={id:'conversation1',revision:1,messages:[] as unknown[],pendingRequest:null,unresolvedOperations:{}};
 const proposal={id:'proposal1',revision:2,title:'Create seed collection task',summary:'One task will be added.',destructive:false,expiresAt:new Date(Date.now()+3600000).toISOString(),status:'review',changes:[{label:'Task',before:'Not saved',after:'Collect native seeds'}]};
 const network=await mockProduction(page,{'/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,conversation),'/api/luna/messages':async route=>{messages++;const request=route.request().postDataJSON();expect(request.text).toBe('Create a seed collection task');expect(request.noteContext).toEqual([]);await jsonRoute(route,{id:'run1',status:'completed',conversation:{...conversation,revision:2,messages:[{id:'reply1',role:'assistant',text:'Please review the task before I save it.',proposal}]}});},'/api/luna/tools/confirm':async route=>{confirms++;const request=route.request().postDataJSON();expect(request.proposalId).toBe('proposal1');expect(request.revision).toBe(2);await jsonRoute(route,{id:route.request().headers()['idempotency-key'],status:'succeeded',conversation:{...conversation,revision:3,messages:[{id:'reply1',role:'assistant',text:'The task was saved.',proposal:{...proposal,status:'applied'}}]}});}});
 await page.goto('/plan');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByLabel('Message Luna').fill('Create a seed collection task');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await expect(page.getByText('Please review the task before I save it.')).toBeVisible();expect(messages).toBe(1);expect(confirms).toBe(0);
 await page.getByRole('button',{name:'Confirm changes',exact:true}).click();await expect(page.getByText('The task was saved.')).toBeVisible();expect(confirms).toBe(1);expect(network.blocked).toEqual([]);
});

test('an unresolved Luna tool review is restored after reload and checked without another mutation',async({page})=>{
 let confirmations=0,checks=0;
 const proposal={id:'proposal2',revision:3,title:'Remove the selected task',summary:'Only this task.',destructive:true,expiresAt:new Date(Date.now()+3600000).toISOString(),status:'review',changes:[{label:'Task',before:'Saved',after:'Deleted'}]};
 const conversation={id:'conversation2',revision:4,messages:[{id:'reply2',role:'assistant',text:'This change needs checking.',proposal}],pendingRequest:null,unresolvedOperations:{proposal2:'operation2'}};
 const network=await mockProduction(page,{'/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/conversations':route=>jsonRoute(route,conversation),'/api/luna/tools/confirm':async route=>{confirmations++;await route.abort();},'/api/luna/operations':async(route,url)=>{checks++;expect(url.searchParams.get('id')).toBe('operation2');await jsonRoute(route,{id:'operation2',status:'failed',message:'No deletion was applied.',conversation:{...conversation,revision:5,unresolvedOperations:{}}});}});
 await page.goto('/plan');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();await expect(page.getByRole('button',{name:'Check action status',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Check action status',exact:true}).click();await expect(page.getByText('No deletion was applied.')).toBeVisible();expect(checks).toBe(1);expect(confirmations).toBe(0);expect(network.blocked).toEqual([]);
});

test('outreach requires the exact review, sends once, and retains unknown attempts for status lookup',async({page})=>{
 let sends=0,id='';let reviewed:Record<string,unknown>|null=null;
 const attempt=()=>({id,status:'failed',from:'me@example.org',to:'office@example.org',subject:'A water question',body:'Please share the current public report.',createdAt:new Date().toISOString(),message:'No submission was recorded.'});
 const network=await mockProduction(page,{'/api/explore/area':area,'/api/outreach/connection':route=>jsonRoute(route,{connected:true,sender:'me@example.org',revision:1}),'/api/outreach/messages':async route=>{if(route.request().method()==='GET'){await jsonRoute(route,{attempts:[],complete:true});return;}sends++;id=route.request().headers()['idempotency-key'];expect(route.request().postDataJSON().reviewId).toBe('review1');await route.abort('failed');},'/api/outreach/messages/prepare':async route=>{const body=route.request().postDataJSON();reviewed=body;await jsonRoute(route,{id:'review1',revision:1,expiresAt:new Date(Date.now()+3600000).toISOString(),from:'me@example.org',to:body.to,subject:body.subject,body:body.body,signature:body.signature});},'/api/outreach/messages/status':async(route,url)=>{expect(url.searchParams.get('id')).toBe(id);await jsonRoute(route,attempt());}});
 await page.goto('/act?view=main&destination=outreach');
 await page.locator('summary').filter({hasText:'Recipient details'}).click();await page.getByLabel('Recipient email',{exact:true}).fill('office@example.org');await page.getByLabel('I checked the recipient and their service area').check();
 await page.getByRole('textbox',{name:'Subject',exact:true}).fill('A water question');await page.getByRole('textbox',{name:'Draft for Utility',exact:true}).fill('Please share the current public report.');
 await page.getByRole('button',{name:'Review what you will share'}).click();await page.locator('summary').filter({hasText:'Send with Gmail'}).click();await page.getByRole('button',{name:'Review send',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('office@example.org');expect(reviewed).not.toBeNull();expect(sends).toBe(0);
 await page.getByRole('button',{name:'Confirm send',exact:true}).click();await expect(page.getByRole('button',{name:'Check pending send'})).toBeVisible();expect(sends).toBe(1);
 await page.getByRole('button',{name:'Check pending send'}).click();await expect(page.getByText('No submission was recorded.')).toBeVisible();expect(sends).toBe(1);expect(network.blocked).toEqual([]);
});
