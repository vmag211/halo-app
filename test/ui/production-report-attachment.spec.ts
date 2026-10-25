import {expect,test} from '@playwright/test';
import {mockProduction,homeId} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';
import {emptyTest,type TestRecord} from '../../lib/frontend/home-test-preview';

/* Release QA 2026-10-25: storing a report from inside the results form raises the test's revision by
 * one (B14 Ruling A7). The open results draft follows that step, so saving it is not refused as a
 * change made elsewhere, and the file picker offers only what the server stores. */
const base:TestRecord={...emptyTest('report-test'),title:'Kitchen tap report',purpose:'Keep my original report',contextId:homeId,contextSnapshot:{label:'Current home',revision:1},medium:'water',kind:'water',revision:4};
const descriptor={id:'file-1',revision:1,name:'report.jpg',mime:'image/jpeg',bytes:3,status:'ready',metadataRemoved:true};
const jpeg={name:'report.jpg',mimeType:'image/jpeg',buffer:Buffer.from([0xff,0xd8,0xff])};

test('the summary says before generation which selected score it cannot include',async({page})=>{
 // The default production mocks answer both score reads with no score.
 const network=await mockProduction(page,{'/api/summaries':route=>jsonRoute(route,{items:[],complete:true,unresolvedOperations:[]})});
 await page.goto('/home?destination=summary');
 const contents=page.getByRole('region',{name:'Selected report contents'});
 await expect(contents).toContainText('Today and Homeguard scores unavailable');
 await page.getByRole('checkbox',{name:'Today & Homeguard scores',exact:true}).uncheck();
 await expect(contents).not.toContainText('scores unavailable');expect(network.blocked).toEqual([]);
});

test('a report stored from the results form does not make the form\'s own save a conflict',async({page})=>{
 let record:TestRecord&{attachments?:unknown[]}={...base};let expected=-1;
 const network=await mockProduction(page,{
  '/api/frontend/capabilities':route=>jsonRoute(route,{capabilities:{tasks:true,workspace:true,attachments:true,summaries:true,projects:false,outreach:false,participation:false,luna:false,recovery:false}}),
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='tests'?[record]:[],availability:'ready',complete:true,pendingOperations:[]}),
  '/api/attachments':async route=>{record={...record,revision:record.revision+1,attachments:[descriptor]};await jsonRoute(route,descriptor);},
  '/api/frontend/workspace/commands':async route=>{const command=route.request().postDataJSON();expected=command.expectedRevision;record={...record,...command.record,revision:record.revision+1};await jsonRoute(route,{operationId:command.operationId,status:'succeeded',changes:{tests:[record]},revisions:{tests:record.revision}});},
 });
 await page.goto('/home?destination=tests');await page.getByText('Kitchen tap report').first().click();
 await page.getByRole('button',{name:'Enter results',exact:true}).click();
 await page.getByLabel(/Analyte or parameter/).fill('Nitrate');await page.getByLabel(/Original reported value/).fill('1.2');await page.getByLabel(/Original reported unit/).fill('mg/L');
 await page.locator('summary',{hasText:'Review a local report'}).click();
 const picker=page.locator('section[aria-label="Private attachment review"] input[type=file]');
 await expect(picker).toHaveAttribute('accept','image/jpeg,image/png,image/webp');
 await picker.setInputFiles({name:'report.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7')});
 await expect(page.getByText(/Choose a nonempty JPEG, PNG or WebP image no larger than 4 MB/)).toBeVisible();
 await picker.setInputFiles(jpeg);await page.getByLabel(/I inspected the original/).check();
 await page.getByRole('button',{name:'Save private report',exact:true}).click();await expect(page.getByText('Private file stored.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:/^Save (results|uninterpreted record|confirmed transcription|unconfirmed transcription)$/}).click();
 await expect.poll(()=>expected).toBe(5);
 await expect(page.getByText(/This record changed/)).toHaveCount(0);expect(network.blocked).toEqual([]);
});
