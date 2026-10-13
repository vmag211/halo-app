import { test, expect, type Page } from '@playwright/test';
const root='/foundation/preview/expanded/?tab=plan&motion=reduce';
const faults=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{const errors:string[]=[];faults.set(page,errors);page.on('pageerror',error=>errors.push(error.message));await page.route('**/*',route=>{const url=new URL(route.request().url());if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname.startsWith('/api/')){errors.push(`Unexpected request ${url.pathname}`);return route.abort();}return route.continue();});});
test.afterEach(async({page})=>expect(faults.get(page)).toEqual([]));
async function open(page:Page,role='publisher'){await page.goto(root);await page.getByText('Expanded app review · Not approved',{exact:true}).click();await page.getByText('Source operations review',{exact:true}).click();await page.getByRole('combobox',{name:'Operator review role',exact:true}).selectOption(role);return page.getByRole('region',{name:'Source operations workspace'});}
async function prepare(page:Page,decision:string){await page.getByRole('textbox',{name:'Decision reason',exact:true}).fill('Checked the exact content, source dates and retained evidence.');await page.getByRole('group',{name:'Source decisions'}).getByRole('button',{name:decision,exact:true}).click();}
async function confirm(page:Page){await page.getByRole('button',{name:'Confirm decision',exact:true}).click();}
async function decide(page:Page,decision:string){await prepare(page,decision);await confirm(page);await expect(page.getByRole('region',{name:'Source decision review'})).toHaveCount(0);}

test('Operator access is distinct from household access and viewer role is read only',async({page})=>{
 await open(page,'denied');await expect(page.getByText('Source operations require a verified operator role.',{exact:false})).toBeVisible();
 await expect(page.getByRole('region',{name:'Source operations workspace'})).toHaveCount(0);
 await page.getByRole('combobox',{name:'Operator review role',exact:true}).selectOption('viewer');
 const actions=page.getByRole('group',{name:'Source decisions'});for(const button of await actions.getByRole('button').all())await expect(button).toBeDisabled();
 await expect(page.getByRole('navigation').getByText('Source operations',{exact:true})).toHaveCount(0);
});
test('Approval, translation, publisher confirmation and withdrawal preserve revision history',async({page})=>{
 const workspace=await open(page,'reviewer');await prepare(page,'Publish reviewed content');await expect(workspace.getByRole('status')).toContainText('current role');
 await decide(page,'Approve candidate');await decide(page,'Approve Spanish translation');await workspace.getByText('Translation and supported coverage',{exact:true}).click();await expect(workspace).toContainText('awaiting matching publication');
 await page.getByRole('combobox',{name:'Operator review role',exact:true}).selectOption('publisher');
 await prepare(page,'Publish reviewed content');const review=page.getByRole('region',{name:'Source decision review'});await expect(review).toContainText('separate deduplicated notification intent');await confirm(page);await expect(review).toHaveCount(0);
 await expect(workspace.locator('.source-ops-summary').first()).toContainText('guide-3');await expect(workspace).not.toContainText('awaiting matching publication');
 await decide(page,'Withdraw publication');await expect(workspace.locator('.source-ops-summary').first()).toContainText('No active publication');
 await workspace.getByText('Retained versions and audit history',{exact:true}).click();await expect(workspace).toContainText('guide-2 · superseded');await expect(workspace).toContainText('guide-3 · withdrawn');
 await expect(workspace.locator('ol > li')).toHaveCount(4);
});
test('An unexpected empty import is quarantined, never an all-clear, and failed retry retains published evidence',async({page})=>{
 const workspace=await open(page);await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('water');
 await expect(workspace).toContainText('Unexpectedly empty dataset is not a measured zero');await expect(workspace).toContainText('18 rejected');
 await prepare(page,'Approve candidate');await expect(workspace.getByRole('status')).toContainText('unresolved validation failures');
 await decide(page,'Quarantine candidate');await expect(workspace.locator('.source-ops-summary').first()).toContainText('water-5');await expect(workspace).toContainText('water-6 · quarantined');
 await page.getByRole('combobox',{name:'Source',exact:true}).selectOption('air');await decide(page,'Retry failed run');
 await expect(workspace.locator('.source-ops-summary').first()).toContainText('air-7');await expect(workspace).toContainText('Stale, last valid retained');await expect(workspace).toContainText('No candidate');
});
test('Failed and offline decisions retain drafts, unknown outcomes require status before retry',async({page})=>{
 const workspace=await open(page);await page.getByRole('combobox',{name:'Operator review outcome',exact:true}).selectOption('failure');await prepare(page,'Approve candidate');await confirm(page);
 await expect(workspace.getByRole('status')).toContainText('not saved');await expect(page.getByRole('textbox',{name:'Decision reason'})).toHaveValue('Checked the exact content, source dates and retained evidence.');
 await page.getByRole('combobox',{name:'Operator review outcome',exact:true}).selectOption('offline');await confirm(page);await expect(workspace.getByRole('status')).toContainText('offline');
 await page.getByRole('combobox',{name:'Operator review outcome',exact:true}).selectOption('unknown');await confirm(page);await expect(workspace.getByRole('status')).toContainText('not confirmed');
 await expect(page.getByRole('button',{name:'Confirm decision',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Check operation status'}).click();await expect(workspace.getByRole('status')).toContainText('Still unconfirmed');
 await page.getByRole('combobox',{name:'Operator status check',exact:true}).selectOption('not-written');await page.getByRole('button',{name:'Check operation status'}).click();await expect(workspace.getByRole('status')).toContainText('no change occurred');
 await page.getByRole('combobox',{name:'Operator review outcome',exact:true}).selectOption('saved');await confirm(page);await expect(page.getByRole('region',{name:'Source decision review'})).toHaveCount(0);
 await workspace.getByText('Retained versions and audit history',{exact:true}).click();await expect(workspace.locator('ol > li')).toHaveCount(1);
});
test('A changed revision or revoked role cannot execute an already prepared decision',async({page})=>{
 const workspace=await open(page);await prepare(page,'Approve candidate');await page.getByRole('button',{name:'Simulate a newer source revision'}).click();await confirm(page);await expect(workspace.getByRole('status')).toContainText('revision changed');
 await page.getByRole('button',{name:'Cancel decision',exact:true}).click();await prepare(page,'Approve candidate');await page.getByRole('combobox',{name:'Operator review role',exact:true}).selectOption('viewer');await confirm(page);await expect(workspace.getByRole('status')).toContainText('current role');
 await expect(workspace.locator('.source-ops-summary').first()).toContainText('guide-3 · incoming');
});
test('Cancellation stops a pending decision and the external operator surface fits 320 pixels',async({page})=>{
 await page.setViewportSize({width:320,height:740});const workspace=await open(page);await prepare(page,'Approve candidate');await confirm(page);await page.getByRole('button',{name:'Cancel pending decision',exact:true}).click();await expect(workspace.getByRole('status')).toContainText('cancelled');await expect(workspace.locator('.source-ops-summary').first()).toContainText('incoming');
 await expect(workspace.getByRole('textbox',{name:'Decision reason'})).not.toBeDisabled();
 expect(await page.locator('.source-ops-review').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBeTruthy();
});
