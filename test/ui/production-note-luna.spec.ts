import {expect,test,type Page} from '@playwright/test';
import type {FieldNote} from '../../lib/frontend/explore-preview';
import {mockProduction} from './production-fixtures';
import {jsonRoute} from './stage-fixtures';

// F07: a note is household data and production Luna never receives it (B09 decision 2), so the
// note's Luna handoff must say so before anything is chosen, offer no field selection or consent,
// and never attach a note to a message. Every service call is intercepted.
const note:FieldNote={id:'note-1',title:'Cloudy creek water',revision:3,kind:'Appearance',observedAt:'2026-10-20T09:15',timezone:'America/New_York',place:'Private creek bend',description:'The water near the bridge looked cloudier than last week.',status:'draft',reference:''};
const caps={available:true,providerLabel:'Luna answers health and environment questions from published sources, and other questions from general knowledge',retentionSummary:'Luna cites the sources behind health and environment answers, marks general answers as its own, and cannot add tasks, set reminders, change anything in HALO or act for you. Your home readings, notes, journal and tasks are not part of this conversation.',publicRetrieval:false,context:{tasks:false,home:false,projects:false},tools:[]};
const conversation={id:'11111111-1111-4111-8111-111111111111',revision:1,messages:[],pendingRequest:null,unresolvedOperations:{}};

async function openNote(page:Page,available:boolean){
 const posts:unknown[]=[];
 const network=await mockProduction(page,{
  '/api/frontend/workspace':(route,url)=>jsonRoute(route,{records:url.searchParams.get('collection')==='exploreNotes'?[note]:[],revision:2,availability:'ready',complete:true,pendingOperations:[]}),
  '/api/luna/capabilities':route=>jsonRoute(route,available?caps:{...caps,available:false,providerLabel:'Luna is not available yet',retentionSummary:'You can still use HALO directly.'}),
  '/api/luna/conversations':route=>jsonRoute(route,conversation),
  '/api/luna/messages':async route=>{const body=route.request().postDataJSON();posts.push(body);await jsonRoute(route,{id:'22222222-2222-4222-8222-000000000001',status:'completed',conversation:{...conversation,revision:2,messages:[{id:'u1',role:'user',text:body.text},{id:'a1',role:'assistant',text:'A general answer.'}]}});},
 });
 await page.goto('/app/explore/notes');
 await page.locator('.ex-note-row').filter({hasText:note.title}).first().click();
 await page.getByText('Luna and this note',{exact:true}).click();
 return {posts,network};
}

test('the note handoff says notes are not sent and offers no field selection or consent',async({page})=>{
 const {posts,network}=await openNote(page,true);
 const handoff=page.locator('.ex-luna-context');
 await expect(handoff).toContainText('Luna cannot read your notes, so nothing from this note is sent.');
 await expect(handoff).toContainText('It cannot add tasks, set reminders, save notes or change anything in HALO.');
 await expect(handoff.getByRole('checkbox')).toHaveCount(0);
 await expect(handoff).not.toContainText('I choose only these fields');
 await expect(handoff.getByRole('button',{name:'Review Luna request'})).toHaveCount(0);
 await handoff.getByRole('button',{name:'Ask Luna a general question'}).click();
 const dialog=page.getByRole('dialog',{name:'Luna',exact:true});
 await expect(dialog).not.toContainText('selected note');
 await expect(dialog).toContainText('cannot add tasks, set reminders');
 await dialog.getByLabel('Message Luna').fill('What should I ask about cloudy water?');
 await dialog.getByRole('button',{name:'Send message'}).click();
 await expect(dialog.locator('.lc-message--assistant')).toContainText('A general answer.');
 expect(posts).toHaveLength(1);
 expect(posts[0]).toMatchObject({noteContext:[]});
 const sent=JSON.stringify(posts[0]);
 for(const field of [note.title,note.description,note.place,note.observedAt])expect(sent).not.toContain(field);
 expect(network.blocked).toEqual([]);
});

test('with Luna unavailable the note handoff says so and offers nothing to send',async({page})=>{
 const {posts}=await openNote(page,false);
 const handoff=page.locator('.ex-luna-context');
 await expect(handoff).toContainText('Luna is unavailable right now.');
 await expect(handoff.getByRole('button',{name:'Ask Luna a general question'})).toHaveCount(0);
 await expect(handoff.getByRole('checkbox')).toHaveCount(0);
 expect(posts).toHaveLength(0);
});
