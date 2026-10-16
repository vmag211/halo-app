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
