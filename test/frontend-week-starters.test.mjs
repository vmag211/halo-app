import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
import {parseActionCommand,planActionCommand,validActionSnapshot as serverValidSnapshot} from '../lib/actionRules.js';
const {visibleWeekStarters,starterAddCommand,starterForKey,weekStarterIdeas}=await loadFrontend('week-starters');
const {hiddenCompletedCount,emptyAgendaMessage}=await loadFrontend('week-agenda');
const {applyReviewActionCommand,actionReceiptCoversCommand,validActionSnapshot}=await loadFrontend('production/action-service');
const {actionDraftError}=await loadFrontend('expanded-preview');
const {weekStart,dayAdd}=await loadFrontend('week-preview');

const empty={actions:[],metas:{},preferences:{},unresolvedOperations:[]};
const OP='0b6b1d2e-6f5c-4f7e-9c1a-2d3e4f5a6b7c';

test('a household with no tasks sees 3 to 5 dated starter ideas inside this week',()=>{
  for(const today of ['2026-10-19','2026-10-21','2026-10-24','2026-10-25','2026-12-31']){
    const shown=visibleWeekStarters([],[],today);
    assert.ok(shown.length>=3&&shown.length<=5);
    const end=dayAdd(weekStart(today),6);
    for(const starter of shown){assert.ok(starter.date>=today&&starter.date<=end,`${starter.date} in ${today}..${end}`);assert.equal(starter.key,`starter:${starter.id}`);}
  }
  assert.equal(visibleWeekStarters([],[],'2026-10-25').every(starter=>starter.date==='2026-10-25'),true,'Sunday never spills into next week');
});

test('any task, archived or completed, hides every idea; dismissal hides only that idea and keeps the other days',()=>{
  const task={id:'t',key:'personal:x',title:'Mine',date:'',state:'completed',origin:'Personal',reason:'r',revision:1};
  assert.deepEqual(visibleWeekStarters([task],[],'2026-10-20'),[]);
  const all=visibleWeekStarters([],[],'2026-10-20');
  const rest=visibleWeekStarters([],[all[1].id],'2026-10-20');
  assert.equal(rest.length,all.length-1);
  assert.deepEqual(rest.map(s=>[s.id,s.date]),all.filter(s=>s.id!==all[1].id).map(s=>[s.id,s.date]));
  assert.deepEqual(visibleWeekStarters([],weekStarterIdeas.map(s=>s.id),'2026-10-20'),[]);
});

test('idea copy is valid task text, links a real surface and has no em dash',()=>{
  for(const idea of weekStarterIdeas){
    assert.equal(actionDraftError(idea.title,''),null);
    assert.doesNotMatch(JSON.stringify(idea),/—/);
    assert.ok(['home','today','plan','act'].includes(idea.link.tab));
    assert.equal(starterForKey(`starter:${idea.id}`),idea);
  }
  assert.equal(starterForKey('personal:starter:radon-zone'),undefined);
});

test('Add to My Week sends the ordinary add command, which the server accepts and the client confirms',()=>{
  const today='2026-10-20';
  for(const starter of visibleWeekStarters([],[],today)){
    const {seeds,date,options}=starterAddCommand(starter,'America/New_York',today);
    const command={kind:'add',seeds,date,...options};
    // The adapter's body: {...command, operationId} (lib/frontend/production/adapters.ts createActionAdapter.commit).
    const parsed=parseActionCommand({...command,operationId:OP});
    assert.equal(parsed.ok,true,JSON.stringify(parsed.fieldErrors));
    let n=0;const planned=planActionCommand(structuredClone(empty),parsed.command,{newId:()=>`id-${++n}`});
    assert.equal(planned.ok,true,JSON.stringify(planned));
    const snapshot={...planned.next,unresolvedOperations:[]};
    assert.equal(serverValidSnapshot(snapshot),true);
    assert.equal(validActionSnapshot(snapshot),true);
    assert.equal(actionReceiptCoversCommand(command,empty,{operationId:OP,status:'succeeded',snapshot}),true);
    const [task]=snapshot.actions;
    assert.equal(task.title,starter.title);assert.equal(task.date,starter.date);assert.equal(task.state,'saved');
    assert.match(task.reason,/starter idea/);
    // The review (no service) path agrees, and once added the ideas are gone.
    const review=applyReviewActionCommand(empty,command,()=>'review-id');
    assert.equal(review.actions[0].title,starter.title);
    assert.deepEqual(visibleWeekStarters(snapshot.actions,[],today),[]);
  }
});

test('an idea added twice is not duplicated by the server',()=>{
  const [starter]=visibleWeekStarters([],[],'2026-10-20');
  const {seeds,date,options}=starterAddCommand(starter,'America/New_York','2026-10-20');
  const first=planActionCommand(structuredClone(empty),parseActionCommand({kind:'add',seeds,date,...options,operationId:OP}).command,{newId:()=>'a'});
  const again=parseActionCommand({kind:'add',seeds,date,...options,operationId:'1b6b1d2e-6f5c-4f7e-9c1a-2d3e4f5a6b7c'});
  const second=planActionCommand(first.next,again.command,{newId:()=>'b'});
  // The signature expects no metadata yet, so a repeat is refused rather than overwriting.
  assert.equal(second.ok,false);
  assert.equal(first.next.actions.length,1);
});

test('an empty day or agenda says completed work is hidden instead of claiming no plans',()=>{
  const done={id:'d',key:'personal:d',title:'Done',date:'2026-10-20',state:'completed',origin:'Personal',reason:'r',revision:1};
  const open={...done,id:'o',key:'personal:o',state:'saved',date:'2026-10-21'};
  const view={filter:'Everything',showFinished:false,search:'',displayDay:a=>a.date};
  assert.equal(hiddenCompletedCount([done,open],{...view,day:'2026-10-20'}),1);
  assert.equal(emptyAgendaMessage('2026-10-20',1),'Everything planned for this day is done.');
  assert.equal(hiddenCompletedCount([done,open],{...view,day:'2026-10-22'}),0);
  assert.equal(emptyAgendaMessage('2026-10-22',0),'No plans for this day.');
  assert.equal(hiddenCompletedCount([done],view),1);
  assert.equal(emptyAgendaMessage(undefined,1),'Every dated task is done.');
  assert.equal(emptyAgendaMessage(undefined,0),'No dated tasks yet.');
  assert.equal(hiddenCompletedCount([done],{...view,showFinished:true}),0);
  assert.equal(hiddenCompletedCount([done],{...view,filter:'Home'}),0);
  assert.equal(hiddenCompletedCount([{...done,date:''}],view),0,'undated completed work is not a dated plan');
});
