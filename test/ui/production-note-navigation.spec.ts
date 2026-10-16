import {expect,test} from '@playwright/test';
import type {FieldNote} from '../../lib/frontend/explore-preview';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

test('a delayed note save completes once without overriding a main-tab navigation',async({page})=>{
 const notes:FieldNote[]=[];
 let writes=0,requestedToday=false;
 let releaseSave!:()=>void,releaseToday!:()=>void;
 const saveGate=new Promise<void>(resolve=>{releaseSave=resolve;});
 const navigationGate=new Promise<void>(resolve=>{releaseToday=resolve;});
 const network=await mockProduction(page,{
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='exploreNotes'?notes:[],revision:notes.length+1,availability:'ready',complete:true,pendingOperations:[]}),
  '/api/frontend/workspace/commands':async route=>{
   const command=route.request().postDataJSON();
   writes++;
   expect(command.kind).toBe('write');
   expect(command.collection).toBe('exploreNotes');
   expect(command.expectedRevision).toBeNull();
   await saveGate;
   notes.push({...command.record,revision:1});
   await jsonRoute(route,{operationId:command.operationId,status:'succeeded',changes:{exploreNotes:notes},revisions:{exploreNotes:2}});
  },
 });
 // Resolve the write while destination navigation is pending. Next may hide
 // the previous form during this transition, so assert the eventual user outcome.
 await page.route('**/app/today*',async route=>{requestedToday=true;await navigationGate;await route.continue();});
 await page.goto('/app/explore/notes?view=main&exploreView=new');
 await page.getByRole('combobox',{name:'Note type',exact:true}).selectOption('Idea');
 await page.getByLabel('Title (required)',{exact:true}).fill('Keep the next destination');
 await page.getByLabel('Your note (required)',{exact:true}).fill('A saved idea must not pull me out of another tab.');
 await page.getByRole('button',{name:'Save note',exact:true}).click();
 await expect.poll(()=>writes).toBe(1);
 const savedResponse=page.waitForResponse(response=>response.url().includes('/api/frontend/workspace/commands')&&response.status()===200);
 try{
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Today',exact:true}).click({noWaitAfter:true});
  await expect.poll(()=>requestedToday).toBe(true);
  releaseSave();
  await savedResponse;
  expect(notes).toHaveLength(1);
  expect(page.url()).not.toContain('exploreView=detail');
 }finally{
  releaseSave();releaseToday();
 }
 await expect(page).toHaveURL(/\/app\/today(?:\?|$)/);
 // Stay in the same app session so a stale retained draft cannot be hidden by a reload.
 await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Explore',exact:true}).click();
 await page.getByRole('button',{name:'Open my notes',exact:true}).click();
 await expect(page.locator('.ex-note-row')).toHaveCount(1);
 await expect(page.locator('.ex-note-row')).toContainText('Keep the next destination');
 await page.getByRole('button',{name:'Add a note',exact:true}).click();
 await expect(page.getByLabel('Title (required)',{exact:true})).toHaveValue('');
 await expect(page.getByLabel('Factual description (required)',{exact:true})).toHaveValue('');
 expect(notes).toHaveLength(1);
 expect(writes).toBe(1);
 expect(network.blocked).toEqual([]);
});
