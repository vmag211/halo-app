import {expect,test} from '@playwright/test';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

test('Luna separates source findings, interpretation and proposed next steps without executing them',async({page})=>{
 const conversation={id:'grounded',revision:1,messages:[{id:'m',role:'assistant',text:'Here is the distinction.',sources:[{title:'AirNow source',url:'https://www.airnow.gov/'}],evidence:[{kind:'fact',text:'The monitor reports outdoor air.',sourceIndexes:[0],scope:'Outdoor monitor, not your indoor air',observedAt:'2026-10-15T14:00:00Z'},{kind:'interpretation',text:'This can help you decide when to go outside.',sourceIndexes:[0]},{kind:'next-step',text:'Check conditions again before leaving.',sourceIndexes:[]}]}]};
 const network=await mockProduction(page,{'/api/luna/conversations':route=>jsonRoute(route,conversation)});
 await page.goto('/app');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await expect(page.getByRole('region',{name:'From the source',exact:true})).toContainText('Outdoor monitor, not your indoor air');
 await expect(page.getByRole('region',{name:'Luna’s interpretation',exact:true})).toContainText('This can help');
 await expect(page.getByRole('region',{name:'Suggested next step',exact:true})).toContainText('Check conditions');
 await expect(page.locator('.lc-evidence--fact a')).toHaveAttribute('href','https://www.airnow.gov/');
 await expect(page.locator('.lc-evidence--fact time')).toHaveAttribute('datetime','2026-10-15T14:00:00Z');
 expect(network.requests.filter(request=>request.method!=='GET')).toEqual([]);expect(network.blocked).toEqual([]);
});

test('legacy Luna source lists are not silently promoted to claim-level evidence',async({page})=>{
 await mockProduction(page,{'/api/luna/conversations':route=>jsonRoute(route,{id:'legacy',revision:1,messages:[{id:'m',role:'assistant',text:'An older response.',sources:[{title:'Source',url:'https://www.epa.gov/'}]}]})});
 await page.goto('/app');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await expect(page.locator('.lc-answer')).toContainText('An older response.');await expect(page.locator('.lc-evidence')).toHaveCount(0);
 await page.getByText('Sources and scope',{exact:true}).click();await expect(page.locator('.lc-sources')).toContainText('not linked to individual statements');
});

test('a switched-off Luna says so once, with no retry and no conversation-load error',async({page})=>{
 const off={available:false,providerLabel:'Luna is not available yet',retentionSummary:'You can still use HALO directly.',publicRetrieval:false,context:{tasks:false,home:false,projects:false},tools:[],reason:'Luna is switched off.'};
 await mockProduction(page,{'/api/luna/capabilities':route=>jsonRoute(route,off),'/api/luna/conversations':route=>jsonRoute(route,{code:'feature_unavailable',error:{code:'feature_unavailable',message:'Luna is not available yet. Nothing was changed.'}},503)});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 const footer=page.locator('.lc-footer');
 await expect(footer).toContainText('Luna is not available yet. You can still use HALO directly.');
 await expect(footer).not.toContainText('could not load');
 await expect(footer.getByRole('button',{name:'Try again'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Find local ways to volunteer'})).toBeDisabled();
});

test('a rate-limited new message leaves no request to check or cancel',async({page})=>{
 const caps={available:true,providerLabel:'Luna answers questions from published sources',retentionSummary:'Answers are kept until you clear them.',publicRetrieval:false,context:{tasks:false,home:false,projects:false},tools:[]};
 const network=await mockProduction(page,{'/api/luna/capabilities':route=>jsonRoute(route,caps),'/api/luna/messages':route=>jsonRoute(route,{error:{code:'rate_limited',message:'limit'}},429)});
 await page.goto('/today');await page.getByRole('button',{name:'Ask Luna',exact:true}).click();
 await page.getByLabel('Message Luna').fill('Is the air ok today?');await page.getByRole('button',{name:'Send message'}).click();
 await expect(page.locator('.lc-footer')).toContainText('Please wait before trying again.');
 await expect(page.getByRole('button',{name:'Check existing request'})).toHaveCount(0);
 await expect(page.getByLabel('Message Luna')).toHaveValue('Is the air ok today?');
 await expect(page.getByRole('button',{name:'Send message'})).toBeEnabled();
 expect(network.requests.filter(request=>request.path.startsWith('/api/luna/runs'))).toEqual([]);
});
