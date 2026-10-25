import {expect,test,type Page} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

// Luna with the capability ON, end to end, against a stateful stand-in for the five
// /api/luna routes that answers in the shapes the real routes do (app/api/luna/*).
const caps={available:true,providerLabel:'Luna answers questions from published health and environmental sources',retentionSummary:'Luna quotes and cites those sources, and cannot add tasks, set reminders, change anything in HALO or act for you. Your home readings, notes, journal and tasks are not part of this conversation. Your questions and the answers are kept in your account until you clear this conversation or delete your account.',publicRetrieval:false,context:{tasks:false,home:false,projects:false},tools:[]};
type Turn={id:string;role:'user'|'assistant';text:string;sources?:{title:string;url:string}[];evidence?:unknown[]};
type Options={polls?:number;answer?:(question:string)=>Omit<Turn,'id'|'role'>;turns?:Turn[]};

async function lunaServer(page:Page,options:Options={}){
 const state={revision:1,turns:[...(options.turns??[])],runs:new Map<string,{status:string;question:string;client:string;polls:number}>(),posts:0,cancels:0,clears:0};
 const conversation=()=>{const open=[...state.runs.entries()].find(([,run])=>['queued','generating'].includes(run.status));return {id:'11111111-1111-4111-8111-111111111111',revision:state.revision,messages:state.turns,pendingRequest:open?{id:open[1].client,text:open[1].question,runId:open[0]}:null,unresolvedOperations:{}};};
 const answer=options.answer??(()=>({text:'Radon is a gas that collects indoors.',sources:[{title:'EPA, Radon',url:'https://www.epa.gov/radon'}],evidence:[{kind:'fact',text:'Radon is a radioactive gas.',sourceIndexes:[0]}]}));
 const network=await mockProduction(page,{
  '/api/luna/capabilities':route=>jsonRoute(route,caps),
  '/api/luna/conversations':route=>jsonRoute(route,conversation()),
  '/api/luna/messages':async route=>{const body=route.request().postDataJSON();state.posts++;state.turns.push({id:`u${state.turns.length}`,role:'user',text:body.text});state.revision++;const id=`22222222-2222-4222-8222-${String(state.posts).padStart(12,'0')}`;state.runs.set(id,{status:'queued',question:body.text,client:body.clientMessageId,polls:0});await jsonRoute(route,{id,status:'queued',conversation:conversation()});},
  '/api/luna/runs/status':async(route,url)=>{const asked=url.searchParams.get('id')!;const found=[...state.runs.entries()].find(([key,item])=>key===asked||item.client===asked);const id=found?.[0]??asked;const run=found?.[1];if(!run){await jsonRoute(route,{id,status:'failed',message:'Luna could not finish that answer. Your question is kept.'});return;}
   if(['queued','generating'].includes(run.status)){run.polls++;if(run.polls>(options.polls??1)){run.status='completed';state.turns.push({id:`a${state.turns.length}`,role:'assistant',...answer(run.question)});state.revision++;}else run.status='generating';}
   await jsonRoute(route,{id,status:run.status,...(run.status==='failed'?{message:'Luna could not finish that answer. Your question is kept.'}:{}),...(['completed','failed','cancelled'].includes(run.status)?{conversation:conversation()}:{})});},
  '/api/luna/runs/cancel':async route=>{const body=route.request().postDataJSON();state.cancels++;const entry=[...state.runs.entries()].find(([id,run])=>id===body.id||run.client===body.id);if(entry&&['queued','generating'].includes(entry[1].status))entry[1].status='cancelled';await jsonRoute(route,{id:entry?.[0]??body.id,status:entry?.[1].status??'failed',message:'Request stopped. Your question is kept.',conversation:conversation()});},
  '/api/luna/conversations/clear':async route=>{state.clears++;state.turns=[];state.runs.clear();state.revision++;await jsonRoute(route,conversation());},
 });
 return {state,network};
}

test('a question is asked, shown at once, answered with its source, and the conversation survives a reload',async({page})=>{
 const {state,network}=await lunaServer(page,{polls:2});
 const errors:string[]=[];page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 const input=page.getByLabel('Message Luna');await input.fill('What is radon?');await input.press('Enter');
 await expect(page.locator('.lc-message--user')).toContainText('What is radon?');
 await expect(page.locator('.lc-message--assistant')).toContainText('Radon is a gas that collects indoors.');
 await expect(page.locator('.lc-evidence--fact a')).toHaveAttribute('href','https://www.epa.gov/radon');
 await expect(input).toHaveValue('');await expect(input).toBeEnabled();
 expect(state.posts).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await expect(page.locator('.lc-message--assistant')).toContainText('Radon is a gas that collects indoors.');
 expect(network.blocked).toEqual([]);expect(errors).toEqual([]);
});

test('a pending answer can be cancelled, keeps the question, and stops asking',async({page})=>{
 const {state}=await lunaServer(page,{polls:1000});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByLabel('Message Luna').fill('What is radon?');await page.getByRole('button',{name:'Send message'}).click();
 await expect(page.getByRole('status').filter({hasText:'Thinking it through'})).toBeVisible();
 await page.getByRole('button',{name:'Cancel request'}).click();
 await expect(page.locator('.lc-footer')).toContainText('Request stopped. Your question is kept.');
 await expect(page.locator('.lc-message--user')).toContainText('What is radon?');
 await expect(page.getByRole('button',{name:'Check existing request'})).toHaveCount(0);
 expect(state.cancels).toBe(1);const polls=[...state.runs.values()][0].polls;await page.waitForTimeout(2500);expect([...state.runs.values()][0].polls).toBe(polls);
 await page.getByLabel('Message Luna').fill('And lead?');await expect(page.getByRole('button',{name:'Send message'})).toBeEnabled();
});

test('a reload during a pending answer parks it, and checking it collects the answer without asking again',async({page})=>{
 const {state}=await lunaServer(page,{polls:1000});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByLabel('Message Luna').fill('What is radon?');await page.getByRole('button',{name:'Send message'}).click();
 await expect(page.getByRole('status').filter({hasText:'Thinking it through'})).toBeVisible();
 await page.reload();[...state.runs.values()][0].polls=1001;
 await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByRole('button',{name:'Check existing request'}).click();
 await expect(page.locator('.lc-message--assistant')).toContainText('Radon is a gas that collects indoors.');
 expect(state.posts).toBe(1);
});

test('a send whose response is lost is reconciled by its own id, not sent twice',async({page})=>{
 const {state}=await lunaServer(page,{polls:0});
 let lose=true;
 await page.route('**/api/luna/messages',async route=>{if(!lose){await route.fallback();return;}lose=false;const body=route.request().postDataJSON();state.posts++;state.turns.push({id:'u0',role:'user',text:body.text});state.revision++;state.runs.set('33333333-3333-4333-8333-000000000001',{status:'queued',question:body.text,client:body.clientMessageId,polls:0});await route.abort('connectionreset');});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByLabel('Message Luna').fill('What is radon?');await page.getByRole('button',{name:'Send message'}).click();
 await expect(page.getByRole('button',{name:'Check existing request'})).toBeVisible();
 await page.getByRole('button',{name:'Check existing request'}).click();
 await expect(page.locator('.lc-message--assistant')).toContainText('Radon is a gas that collects indoors.');
 expect(state.posts).toBe(1);
});

test('a failed answer keeps the question and lets the person ask again',async({page})=>{
 const {state}=await lunaServer(page,{polls:0});
 await page.route('**/api/luna/runs/status*',async route=>{const id=new URL(route.request().url()).searchParams.get('id')!;const run=state.runs.get(id);if(run)run.status='failed';await route.fallback();});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByLabel('Message Luna').fill('What is radon?');await page.getByRole('button',{name:'Send message'}).click();
 await expect(page.locator('.lc-footer')).toContainText('Luna could not finish that answer. Your question is kept.');
 await expect(page.locator('.lc-message--user')).toContainText('What is radon?');
 await expect(page.getByRole('button',{name:'Check existing request'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Send message'})).toBeEnabled();
});

test('clearing the conversation empties it on the server and on screen',async({page})=>{
 const {state}=await lunaServer(page,{turns:[{id:'u0',role:'user',text:'What is radon?'},{id:'a0',role:'assistant',text:'Radon is a gas.'}]});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await expect(page.locator('.lc-message--assistant')).toContainText('Radon is a gas.');
 await page.getByRole('button',{name:'New conversation'}).click();await page.getByRole('button',{name:'Clear conversation'}).click();
 await expect(page.locator('.lc-footer')).toContainText('Conversation cleared.');await expect(page.locator('.lc-message')).toHaveCount(0);
 expect(state.clears).toBe(1);
 await page.reload();await page.getByRole('button',{name:'Ask Luna',exact:true}).click();await expect(page.locator('.lc-message')).toHaveCount(0);
});

test('Luna opens and closes by keyboard, and focus returns to the launcher',async({page})=>{
 await lunaServer(page);
 await page.goto('/today');const launcher=page.getByRole('button',{name:'Ask Luna',exact:true});await launcher.focus();await page.keyboard.press('Enter');
 const dialog=page.getByRole('dialog',{name:'Luna',exact:true});await expect(dialog).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>!!document.activeElement?.closest('dialog[open]'))).toBe(true);
 // A native modal lets Tab pass through the browser's own controls (body is active), never the page behind it.
 for(let i=0;i<25;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>{const active=document.activeElement;return !active||active===document.body||!!active.closest('dialog[open]');})).toBe(true);}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(launcher).toBeFocused();
});

// The public map is browsing without an account, so it has no Luna by design.
for(const path of ['/today','/home','/act','/plan','/settings']){
 test(`the Luna launcher opens a working conversation on ${path}`,async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await lunaServer(page);await page.goto(path);
  await page.getByRole('button',{name:/^(Ask|Open) Luna$/}).first().click();
  await expect(page.getByRole('dialog',{name:'Luna',exact:true}).getByLabel('Message Luna')).toBeEnabled();
  expect(errors).toEqual([]);
 });
}

test('with published sources only, Luna offers questions it can answer, not actions or notes it cannot take',async({page})=>{
 const {state,network}=await lunaServer(page,{polls:0});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Luna',exact:true});
 await expect(dialog.getByRole('heading',{name:'What would you like to know?'})).toBeVisible();
 await expect(dialog.getByRole('button',{name:'Find projects that fit my home'})).toHaveCount(0);
 await expect(dialog.getByLabel('Message Luna')).toHaveAttribute('placeholder','Ask Luna a question...');
 await expect(dialog.getByRole('button',{name:'New conversation'})).toBeDisabled();
 await dialog.getByRole('button',{name:'Context & privacy'}).click();
 await expect(dialog).toContainText('cannot add tasks, set reminders, change anything in HALO');
 await expect(dialog).not.toContainText('Choose note context');await expect(dialog).not.toContainText('Review every proposed change');
 await expect(dialog.getByRole('button',{name:'Manage context in Settings'})).toHaveCount(0);
 await dialog.getByRole('button',{name:'What is radon and how do I test for it?'}).click();
 await expect(dialog.locator('.lc-message--assistant')).toContainText('Radon is a gas');
 const post=network.requests.find(request=>request.path==='/api/luna/messages');
 expect(post?.body).toMatchObject({text:'What is radon and how do I test for it?',page:'Today',noteContext:[]});
 expect(state.posts).toBe(1);await expect(dialog.getByRole('button',{name:'New conversation'})).toBeEnabled();
});
