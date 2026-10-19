import { test, expect, type Page } from '@playwright/test';
const root='/foundation/preview/expanded/?review=tools&tab=act&motion=reduce';
const errors=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
 const faults:string[]=[];errors.set(page,faults);page.on('pageerror',error=>faults.push(error.message));
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname.startsWith('/api/')){faults.push(`Unexpected request ${url.pathname}`);return route.abort();}return route.continue();});
});
test.afterEach(async({page})=>expect(errors.get(page)).toEqual([]));
async function open(page:Page){await page.getByRole('button',{name:'Ask Luna',exact:true}).click();return page.getByRole('dialog',{name:'Luna',exact:true});}
async function say(page:Page,message:string){await page.getByRole('textbox',{name:'Message Luna',exact:true}).fill(message);await page.getByRole('button',{name:'Send message',exact:true}).click();}
async function add(page:Page,title:string){await say(page,`Create a task: ${title}`);await page.getByRole('button',{name:'Save task',exact:true}).click();}
async function close(page:Page){await page.getByRole('dialog',{name:'Luna',exact:true}).getByRole('button',{name:'Close sheet',exact:true}).click();}
async function scenario(page:Page,label:string,value:string){await close(page);const summary=page.getByText('Expanded app review · Not approved',{exact:true});await summary.click();await page.getByRole('combobox',{name:label,exact:true}).selectOption(value);await summary.click();await open(page);}

test('Luna renames, completes, reopens, marks waiting and unschedules the same exact task',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'Check native plants');
 const taskId=await dialog.locator('.lc-receipt').getAttribute('data-record-id');
 await say(page,'Rename task Check native plants to Review native plants');
 await expect(dialog.getByLabel('Task title',{exact:true})).toHaveValue('Review native plants');
 await dialog.getByRole('button',{name:'Save change',exact:true}).click();
 await say(page,'Complete task Review native plants');
 await expect(dialog.getByRole('region',{name:'Task change review'})).toContainText('does not change a test result');
 await dialog.getByRole('button',{name:'Mark complete',exact:true}).click();
 await expect(dialog.locator('.lc-receipt').last()).toContainText('Task marked complete');
 await say(page,'Reopen task Review native plants');await dialog.getByRole('button',{name:'Reopen task',exact:true}).click();
 await say(page,'Mark Review native plants waiting');await dialog.getByRole('button',{name:'Mark waiting',exact:true}).click();
 await say(page,'Move task Review native plants to 2026-10-17');await dialog.getByRole('button',{name:'Save change',exact:true}).click();
 await say(page,'Save Review native plants for later');
 await expect(dialog.getByRole('region',{name:'Task change review'})).toContainText('reminder preference and repeat plan');
 await dialog.getByRole('button',{name:'Save for later',exact:true}).click();
 expect(await dialog.locator('.lc-receipt').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-record-id')))).toEqual(Array(7).fill(taskId));
 await close(page);await page.getByRole('link',{name:'My Week',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved for later'})).toContainText('Review native plants');
 await page.locator('.mw-task-open').filter({hasText:'Review native plants'}).first().click();
 await expect(page.locator('#week-task-detail').getByLabel('Status',{exact:true})).toHaveValue('waiting');
});

test('Ambiguous task deletion requires choosing an exact item and cancellation retains both',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'Garden supplies');await add(page,'Garden cleanup');
 await say(page,'Delete task Garden');
 const choices=dialog.getByRole('group',{name:'Choose a task'});await expect(choices.getByRole('button')).toHaveCount(2);
 await expect(dialog.getByRole('button',{name:'Yes, delete',exact:true})).toHaveCount(0);
 await choices.getByRole('button').filter({hasText:'Garden supplies'}).click();
 await dialog.getByRole('button',{name:'No, keep it',exact:true}).click();
 await say(page,'Delete task Garden supplies');
 await expect(dialog.getByRole('region',{name:'Task deletion review'})).toContainText('source record, other tasks, notes and project remain');
 await dialog.getByRole('button',{name:'Yes, delete',exact:true}).click();
 await say(page,'Find task Garden');
 await expect(dialog.locator('.lc-message--assistant').last()).toContainText('Garden cleanup');
 await expect(dialog.locator('.lc-message--assistant').last()).not.toContainText('Garden supplies');
});

test('A stale deletion proposal cannot remove a task changed by a later confirmed review',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'Keep the shared task');
 await say(page,'Delete task Keep the shared task');
 await say(page,'Complete task Keep the shared task');await dialog.getByRole('button',{name:'Mark complete',exact:true}).click();
 await dialog.getByRole('button',{name:'Yes, delete',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Task deletion review'}).getByRole('alert')).toContainText('changed after the review');
 await say(page,'Find task Keep the shared task');await expect(dialog.locator('.lc-message--assistant').last()).toContainText('completed');
});

test('A failed deletion keeps the exact review and retry removes only once',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'Try again task');await say(page,'Delete task Try again task');
 await scenario(page,'Explore workspace state','save-error');
 await dialog.getByRole('button',{name:'Yes, delete',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('Nothing changed');
 await scenario(page,'Explore workspace state','ready');
 await dialog.getByRole('button',{name:'Yes, delete',exact:true}).click();await expect(dialog.locator('.lc-receipt').last()).toContainText('Task removed');
 await expect(dialog.getByRole('button',{name:'Yes, delete',exact:true})).toHaveCount(0);
 await say(page,'Find task Try again task');await expect(dialog.locator('.lc-message--assistant').last()).toContainText('could not find');
});

test('Task context revocation blocks a pending task mutation and keeps manual access',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'Permission-sensitive task');await say(page,'Delete task Permission-sensitive task');await close(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/^Luna & connections/}).click();
 await page.getByRole('switch',{name:'Saved task context',exact:true}).uncheck();await page.getByRole('button',{name:'Save changes',exact:true}).click();
 await page.getByRole('link',{name:'Explore',exact:true}).click();await open(page);await dialog.getByRole('button',{name:'Yes, delete',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('context is turned off');
 await close(page);await page.getByRole('link',{name:'My Week',exact:true}).click();await expect(page.getByRole('region',{name:'Saved for later'})).toContainText('Permission-sensitive task');
});

test('Starting a new conversation confirms draft loss, retains saved work and respects cancel',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'A saved task stays');
 await dialog.getByRole('textbox',{name:'Message Luna'}).fill('Unsent private question');
 await dialog.getByRole('button',{name:'New conversation',exact:true}).click();
 await expect(dialog.getByRole('region',{name:'Clear conversation review'})).toContainText('Saved tasks, notes and projects stay');
 await dialog.getByRole('button',{name:'Keep conversation',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Message Luna'})).toHaveValue('Unsent private question');
 await dialog.getByRole('button',{name:'New conversation',exact:true}).click();await dialog.getByRole('button',{name:'Clear and start new',exact:true}).click();
 await expect(dialog.locator('.lc-message')).toHaveCount(0);await expect(dialog.getByRole('textbox',{name:'Message Luna'})).toHaveValue('');
 await say(page,'Find task A saved task stays');await expect(dialog.locator('.lc-message--assistant').last()).toContainText('A saved task stays');
});

test('An edited-note proposal cannot resurrect a note deleted after its review',async({page})=>{
 await page.goto(root);const dialog=await open(page);await say(page,'Save a note: Creek visit. An observation, not a water measurement.');await dialog.getByRole('button',{name:'Save note',exact:true}).click();
 await say(page,'Edit note Creek visit to: I will check the official source.');
 await expect(dialog.getByRole('textbox',{name:'Note text',exact:true})).toHaveValue('I will check the official source.');
 await say(page,'Delete note Creek visit');await dialog.getByRole('button',{name:'Yes, delete',exact:true}).click();
 await dialog.getByRole('button',{name:'Save note',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('Nothing was overwritten or restored');
 await expect(dialog.getByRole('textbox',{name:'Note text',exact:true})).toHaveValue('I will check the official source.');
});

test('Actual browser offline cancels pending generation and keeps the request without queuing',async({page})=>{
 await page.goto(root);const dialog=await open(page);await say(page,'Find 12 project ideas');
 await expect(dialog.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();await page.context().setOffline(true);
 await expect(dialog).toContainText('Connection lost. Your question is kept');
 await expect(dialog.getByRole('textbox',{name:'Message Luna'})).toHaveValue('Find 12 project ideas');
 await expect(dialog.getByRole('button',{name:'Send message',exact:true})).toBeDisabled();
 await expect(dialog.locator('.lc-projects')).toHaveCount(0);
 await page.context().setOffline(false);await expect(dialog.getByRole('button',{name:'Send message',exact:true})).toBeEnabled();
});

test('Browser Back cancels generation and retains the exact unsent request',async({page})=>{
 await page.goto(root);const dialog=await open(page);await say(page,'Find 12 project ideas for gardening');
 await expect(dialog.getByRole('button',{name:'Cancel request',exact:true})).toBeVisible();await page.goBack();
 await expect(dialog).toHaveCount(0);await open(page);
 await expect(dialog.getByRole('textbox',{name:'Message Luna'})).toHaveValue('Find 12 project ideas for gardening');
 await expect(dialog.locator('.lc-projects')).toHaveCount(0);await expect(dialog.getByRole('button',{name:'Cancel request',exact:true})).toHaveCount(0);
});

test('A Luna receipt opens the exact canonical task without private text in the URL',async({page})=>{
 await page.goto(root);const dialog=await open(page);await add(page,'Exact private task destination');
 await dialog.locator('.lc-receipt').getByRole('button',{name:'Open',exact:true}).click();
 await expect(page.locator('#week-task-detail')).toBeVisible();
 await expect(page.locator('#week-task-detail').getByLabel('Task title',{exact:true})).toHaveValue('Exact private task destination');
 expect(page.url()).not.toContain('Exact');expect(page.url()).not.toContain('private');
});

for(const outcome of ['unknown-not-applied','unknown-applied'])test(`Uncertain ${outcome} is reconciled without blind retry or duplicated tasks`,async({page})=>{
 await page.goto(root);const dialog=await open(page);
 await scenario(page,'Assistant action review outcome',outcome);
 await say(page,'Create a task: One operation only');await dialog.getByRole('button',{name:'Save task',exact:true}).click();
 const status=dialog.getByRole('region',{name:'Action status review'});await expect(status).toContainText('Do not submit it again');
 await expect(dialog.getByRole('button',{name:'Save task',exact:true})).toHaveCount(0);
 await expect(dialog.getByRole('button',{name:'New conversation',exact:true})).toBeDisabled();
 await status.getByRole('button',{name:'Check status',exact:true}).click();await expect(status).toContainText('No new request was sent');
 await scenario(page,'Assistant action status check','resolved');
 await status.getByRole('button',{name:'Check status',exact:true}).click();
 if(outcome==='unknown-not-applied'){
  await expect(dialog.getByRole('alert')).toContainText('this change was not applied');
  await scenario(page,'Assistant action review outcome','saved');await dialog.getByRole('button',{name:'Save task',exact:true}).click();
 }
 await expect(dialog.locator('.lc-receipt')).toHaveCount(1);await expect(dialog.locator('.lc-receipt')).toContainText('Saved in My Week');
 await close(page);await page.getByRole('link',{name:'My Week',exact:true}).click();
 await expect(page.getByRole('region',{name:'Saved for later'}).locator('.mw-task')).toHaveCount(1);
});

test('Settings cannot clear an unresolved Luna operation or erase its task ledger',async({page})=>{
 await page.goto(root);const dialog=await open(page);await scenario(page,'Assistant action review outcome','unknown-applied');
 await say(page,'Create a task: Keep the operation ledger');await dialog.getByRole('button',{name:'Save task',exact:true}).click();await close(page);
 await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:/^Luna & connections/}).click();
 await page.getByText('Conversation history',{exact:true}).click();await page.getByRole('button',{name:'Clear this conversation',exact:true}).click();
 await expect(page.locator('.halo-settings')).toContainText('Open Luna and choose Check status');await expect(page.getByRole('button',{name:'Yes, clear',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'All settings',exact:true}).click();await page.getByRole('button',{name:/^Privacy & data/}).click();
 await page.getByRole('button',{name:/^Delete all HALO data/}).click();await expect(page.locator('.halo-settings')).toContainText('Nothing was deleted');
 await expect(page.getByLabel('Type DELETE to confirm',{exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Explore',exact:true}).click();await open(page);await expect(dialog.getByRole('region',{name:'Action status review'})).toBeVisible();
});

for(const appearance of ['dark','light'])test(`Task review and clearing fit 320px at 150% in ${appearance}`,async({page})=>{
 await page.setViewportSize({width:320,height:800});await page.goto(root+`&appearance=${appearance}&scale=150`);const dialog=await open(page);
 await add(page,'A very descriptive task for environmental preparation');await say(page,'Delete task A very descriptive task for environmental preparation');
 await expect(dialog.getByRole('button',{name:'Yes, delete',exact:true})).toBeVisible();
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
 await dialog.getByRole('button',{name:'New conversation',exact:true}).click();await expect(dialog.getByRole('button',{name:'Keep conversation',exact:true})).toBeVisible();
 expect(await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
});
