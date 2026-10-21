import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {homepageAttention,weeklyHomepageRecap,preparationPlans,meetingMapLink,repeatPlanDates}=await loadFrontend('homepage-preview');
const {emptyWeekMeta}=await loadFrontend('week-preview');
const {blankEngagement,engagementError}=await loadFrontend('explore-workspace');
const action=(id,date='2026-10-12',state='saved',origin='Personal')=>({id,key:`personal:${id}`,title:id,date,state,origin,revision:1,reason:'Owned'});
const meta=patch=>({...emptyWeekMeta,...patch});
test('attention uses chosen schedules and waiting status, excludes paused/archive/completion',()=>{
 const actions=[action('earlier','2026-10-11'),action('waiting','','waiting'),action('done','2026-10-01','completed'),action('paused','2026-10-01'),action('archived','2026-10-01')];
 const items=homepageAttention(actions,{'personal:paused':meta({paused:true}),'personal:archived':meta({archived:true})},[],{},'2026-10-12','America/New_York');assert.deepEqual(items.map(i=>i.title),['earlier','waiting']);
});
test('attention retains actual unreviewed reports without inventing a receipt or deadline',()=>{
 const rows={tests:[{id:'r',title:'Report',rows:[{analyte:'a'}],review:'unreviewed'},{id:'archived',title:'Old',archived:true,rows:[{}],review:'unreviewed'}]};
 const items=homepageAttention([],{},[],rows,'2026-10-12','UTC');assert.equal(items.length,1);assert.equal(items[0].date,'');assert.equal(items[0].route.id,'r');
});
test('weekly recap uses actual completion dates and unique canonical IDs, not due dates',()=>{
 const done=action('a','2026-09-01','completed','Homeguard');const unknown=action('b','2026-10-12','completed');const duplicate={...done};
 const recap=weeklyHomepageRecap([done,unknown,duplicate],{'personal:a':meta({completedOn:'2026-10-12',archived:true})},{},'2026-10-12');assert.equal(recap.completed.length,1);assert.equal(recap.home,1);assert.equal(recap.unknownCompletions,1);assert.equal(recap.days[0].count,1);
});
test('recap only totals self-reported hours with an actual participation date, never update dates',()=>{
 const dated={id:'a',status:'Participated',hours:'1.5',participatedOn:'2026-10-12'};const undated={id:'b',status:'Participated',hours:'12',statusDate:'2026-10-12'};
 const recap=weeklyHomepageRecap([],{}, {exploreEngagements:[dated,undated,{id:'c',status:'Participated',hours:'',participatedOn:'2026-10-13'}]},'2026-10-14');assert.equal(recap.hours,1.5);assert.equal(recap.participation,2);assert.equal(recap.unknownHours,1);assert.equal(recap.undatedParticipation,1);
});
test('preparation respects exact origins, 14-day horizon and saved-action deduplication',()=>{
 const record={id:'a',revision:2,title:'Activity',date:'2026-10-13',status:'Considering',place:'Park entrance',url:'https://example.org',preparation:'Bring your own gloves'};
 const a={...action('a','2026-10-13','saved','Community'),key:'explore:commitment:a'};
 const plans=preparationPlans([a,action('far','2026-11-01','saved','Outdoors'),action('past','2026-10-01','saved','Outdoors')],{}, {exploreEngagements:[record]},'2026-10-12','UTC');assert.equal(plans.length,1);assert.equal(plans[0].place,'Park entrance');assert.equal(plans[0].status,'Considering');assert.equal(plans[0].checks.length,3);
 const updated=preparationPlans([{...a,revision:2}],{}, {exploreEngagements:[record]},'2026-10-12','UTC');assert.notEqual(updated[0].signature,plans[0].signature);
});
test('calendar-zone instant, not stored wall date, determines earlier attention',()=>{
 const a=action('timed','2026-10-12');const items=homepageAttention([a],{'personal:timed':meta({time:'01:00',zone:'UTC'})},[],{},'2026-10-12','America/Los_Angeles');assert.equal(items[0].date,'2026-10-11');
});
test('location links encode only explicit place labels and refuse illustrative addresses',()=>{
 assert.equal(meetingMapLink('Example meeting place'),null);assert.equal(meetingMapLink(''),null);assert.match(meetingMapLink('Park & garden, NC'),/Park%20%26%20garden%2C%20NC/);
});
test('repeat dates are previews without guessed completion dates or timed recurrence',()=>{
 assert.deepEqual(repeatPlanDates(action('a'),meta({recurrence:'weekly'}),'2026-10-12'),['2026-10-19','2026-10-26','2026-11-02']);assert.deepEqual(repeatPlanDates(action('a'),meta({recurrence:'after-completion'}),'2026-10-12'),[]);assert.deepEqual(repeatPlanDates(action('a'),meta({recurrence:'weekly',time:'09:00'}),'2026-10-12'),[]);
});
test('actual participation date is optional for old records, but cannot be future or planned status',()=>{
 const record={...blankEngagement(),title:'Activity',organizer:'Organizer',status:'Participated',statusDate:'2026-10-01',outcome:'I helped'};assert.equal(engagementError(record),null);assert.match(engagementError({...record,participatedOn:'2099-01-01'}),/actually happened/);assert.match(engagementError({...record,status:'Considering',participatedOn:'2026-10-01'}),/participation/);
});
