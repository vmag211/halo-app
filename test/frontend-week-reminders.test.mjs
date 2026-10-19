import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {reminderScheduleSignature,reminderPresentation,validReminderStates}=await loadFrontend('week-reminders');
const {validActionSnapshot,validActionPreferences,applyReviewActionCommand}=await loadFrontend('production/action-service');
const {emptyWeekMeta}=await loadFrontend('week-preview');
const action={id:'task-1',key:'personal:1',revision:3,title:'Review lab result',date:'2026-10-20',state:'saved',origin:'Personal',reason:'User chosen follow-up'};
const meta={...emptyWeekMeta,time:'09:00',reminder:true};
const status=(value,patch={})=>({actionRevision:3,scheduleSignature:reminderScheduleSignature(action,meta),status:value,updatedAt:'2026-10-16T16:00:00Z',...(value==='scheduled'?{scheduledFor:'2026-10-20T12:30:00Z'}:{}),...(value==='delivered'?{deliveredAt:'2026-10-16T15:00:00Z'}:{}),...patch});
const snapshot=(states)=>({actions:[action],metas:{[action.key]:meta},unresolvedOperations:[],...(states?{reminderStates:states}:{})});

test('older action snapshots remain valid without reminder service evidence',()=>{
 assert.equal(validActionSnapshot(snapshot()),true);
 assert.deepEqual(reminderPresentation(action,meta),{label:'Requested',tone:'quiet',detail:'Your task requests a reminder. Scheduling and delivery are not confirmed.'});
});
for(const [value,label] of [['pending','Pending'],['registered','Registered'],['scheduled','Scheduled'],['delivered','Delivered'],['failed','Delivery failed'],['cancelled','Cancelled'],['paused','Paused'],['unknown','Status unknown']])test(`canonical ${value} reminder state has a distinct truthful display`,()=>{
 assert.equal(validActionSnapshot(snapshot({[action.id]:status(value)})),true);
 assert.equal(reminderPresentation(action,meta,status(value)).label,label);
});
test('scheduler status requires real timestamps, known actions and positive captured revisions',()=>{
 for(const candidate of [status('scheduled',{scheduledFor:undefined}),status('delivered',{deliveredAt:undefined}),status('scheduled',{updatedAt:'2026-10-16 12:00'}),status('scheduled',{channel:'sms'}),status('scheduled',{actionRevision:0}),status('anything'),status('scheduled',{scheduleSignature:''})])assert.equal(validReminderStates({[action.id]:candidate},[action]),false);
 assert.equal(validActionSnapshot(snapshot({foreign:status('delivered')})),false);
 for(const updatedAt of ['2026-02-30T12:00:00Z','2026-13-01T12:00:00Z','2026-10-16T24:00:00Z','2026-10-16T12:60:00Z','2026-10-16T12:00:00+14:30','2026-10-16T12:00:00-25:00','2026-10-16T12:00:00Z extra'])assert.equal(validReminderStates({[action.id]:status('pending',{updatedAt})},[action]),false);
 assert.equal(validReminderStates({[action.id]:status('pending',{updatedAt:'2024-02-29T12:00:00.123+14:00'})},[action]),true);
});
test('changed revisions or dates never retain a current scheduled or delivered label',()=>{
 const old=status('scheduled');
 for(const changed of [{...action,revision:4},{...action,date:'2026-10-21'},{...action,state:'completed'}])assert.equal(reminderPresentation(changed,meta,old).label,'Needs sync');
 for(const changed of [{...meta,time:'10:00'},{...meta,zone:'America/Chicago'},{...meta,reminder:false},{...meta,paused:true},{...meta,archived:true}])assert.equal(reminderPresentation(action,changed,old).label,'Needs sync');
 assert.equal(reminderScheduleSignature(action,{...meta,note:'private text',history:['edit']}),reminderScheduleSignature(action,meta));
});
test('completion and disabled requests distinguish stop intent from service cancellation',()=>{
 assert.equal(reminderPresentation(action,{...meta,paused:true}).label,'Stop pending');
 assert.equal(reminderPresentation({...action,state:'completed'},meta).label,'Stop pending');
 assert.equal(reminderPresentation({...action,date:''},meta).label,'Date needed');
 assert.equal(reminderPresentation(action,{...meta,reminder:false}).label,'Off');
 const paused={...meta,paused:true};
 assert.equal(reminderPresentation(action,paused,status('paused',{scheduleSignature:reminderScheduleSignature(action,paused)})).label,'Paused');
});
test('reminder service evidence never becomes a writable preference or simulated receipt',()=>{
 assert.equal(validActionPreferences({'week:reminderStates':{[action.id]:status('scheduled')}}),false);
 const command={kind:'revise',changes:[{id:action.id,revision:3,patch:{title:action.title,date:action.date,state:'completed'}}]};
 const next=applyReviewActionCommand(snapshot({[action.id]:status('scheduled')}),command,()=> 'new');
 assert.equal(next.reminderStates,undefined);
});
