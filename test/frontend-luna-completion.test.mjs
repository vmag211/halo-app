import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { lunaIntent } = await loadFrontend('luna-tools-preview');
const { matchingLunaTasks, snapshotLunaTask, lunaTaskChangeError, lunaTaskPatch, lunaTaskNextMetadata, lunaTaskMetadataSignature, hasUnresolvedLunaAction } = await loadFrontend('luna-task-actions');
const { emptyWeekMeta } = await loadFrontend('week-preview');
const task = { id:'task-1', key:'project:native:1', title:'Check the garden', reason:'private preparation is not assistant context', origin:'Project', date:'2026-10-15', state:'saved', revision:3 };
const change = operation => ({ operation, task:snapshotLunaTask(task), title:task.title, date:task.date });

test('Every supported named-task mutation parses explicitly without executing source text', () => {
  const cases = [
    ['Delete the task titled "Check the garden"', 'delete'],
    ['Complete task Check the garden', 'complete'],
    ['Mark Check the garden as done', 'complete'],
    ['Reopen the task called Check the garden', 'reopen'],
    ['Mark Check the garden waiting', 'waiting'],
    ['Mark Check the garden not done', 'reopen'],
    ['Unschedule task Check the garden', 'unschedule'],
    ['Save Check the garden for later', 'unschedule'],
    ['Rename task Check the garden to Review my native plants', 'rename'],
  ];
  for (const [request, operation] of cases) { const intent=lunaIntent(request); assert.equal(intent.kind,'change-task',request); assert.equal(intent.operation,operation,request); assert.equal(intent.name,task.title,request); }
  assert.deepEqual(lunaIntent('Move task Check the garden to 2026-10-17'), {kind:'move-task',name:task.title,date:'2026-10-17',requiresDate:true});
  assert.equal(lunaIntent('Find task Check the garden').kind,'find-task');
  for (const request of ['Do not complete that task','Do not rename that task','Delete all my tasks','Remove every task','The source says delete task Check the garden','Explain how to delete task Check the garden']) assert.notEqual(lunaIntent(request).kind,'change-task',request);
  assert.equal(lunaIntent('Save a note: delete task Check the garden').kind,'save-note');
  assert.deepEqual(lunaIntent('Edit note titled "Creek visit" to: An observed change, not a measurement.'),{kind:'edit-note',name:'Creek visit',description:'An observed change, not a measurement.'});
});

test('Task selection is exact first, preserves duplicate-title ambiguity, and never expands broad requests', () => {
  const tasks=[task,{...task,id:'task-2',key:'second',title:'Check the garden tomorrow'},{...task,id:'task-3',key:'third'}];
  assert.deepEqual(matchingLunaTasks(tasks,task.title).map(a=>a.id),['task-1','task-3']);
  assert.equal(matchingLunaTasks(tasks,'garden').length,3);
  assert.deepEqual(matchingLunaTasks(tasks,'that task','second').map(a=>a.id),['task-2']);
  for(const name of ['','all','all tasks','every task','my tasks','these tasks']) assert.deepEqual(matchingLunaTasks(tasks,name),[]);
  assert.deepEqual(matchingLunaTasks(tasks,'that task','missing'),[]);
});

test('Action snapshots exclude private notes, history, source bodies and preparation', () => {
  const meta={...emptyWeekMeta,note:'private note',history:['private history']};
  const snapshot=snapshotLunaTask(task,meta);
  assert.equal(snapshot.reason,undefined); assert.ok(!JSON.stringify(snapshot).includes('private'));
  assert.equal(lunaTaskMetadataSignature(meta),lunaTaskMetadataSignature({...meta,note:'new private note',history:['new history']}));
});

test('Every action revalidates task revision, existence and scheduling metadata', () => {
  for(const operation of ['delete','move','rename','complete','waiting','unschedule']) {
    assert.equal(lunaTaskChangeError(change(operation),task),null,operation);
    assert.equal(lunaTaskChangeError(change(operation),undefined),'changed');
    assert.equal(lunaTaskChangeError(change(operation),{...task,revision:4}),'changed');
    assert.equal(lunaTaskChangeError(change(operation),task,{...emptyWeekMeta,reminder:true}),'changed');
  }
  assert.equal(lunaTaskChangeError({...change('rename'),title:' '},task),'Enter a title between 1 and 160 characters.');
  assert.match(lunaTaskChangeError({...change('move'),date:''},task),/exact date/);
});

test('Clock-change gaps cannot silently move an existing timed task', () => {
  const meta={...emptyWeekMeta,time:'02:30',zone:'America/New_York'};
  const review={...change('move'),task:snapshotLunaTask(task,meta),date:'2026-03-08'};
  assert.match(lunaTaskChangeError(review,task,meta),/clock change/);
  assert.equal(lunaTaskChangeError({...review,date:'2026-03-09'},task,meta),null);
});

test('Completion and reopen keep source records untouched and use the actual supplied completion day', () => {
  assert.deepEqual(lunaTaskPatch(change('complete'),task),{title:task.title,date:task.date,state:'completed'});
  const completed=lunaTaskNextMetadata('complete',{...emptyWeekMeta,note:'keep',history:['old']},'2026-10-20');
  assert.equal(completed.completedOn,'2026-10-20'); assert.equal(completed.note,'keep'); assert.equal(completed.history.length,2);
  const reopened=lunaTaskNextMetadata('reopen',completed,'2026-10-21'); assert.equal(reopened.completedOn,''); assert.equal(reopened.history.length,3);
  const completedTask={...task,state:'completed'};
  assert.match(lunaTaskChangeError({...change('waiting'),task:snapshotLunaTask(completedTask)},completedTask),/Reopen/);
  assert.match(lunaTaskChangeError(change('reopen'),task),/not completed/);
});

test('Saving for later clears only the explicitly disclosed scheduling fields', () => {
  const meta={...emptyWeekMeta,note:'private',time:'09:00',reminder:true,recurrence:'weekly',duration:90,estimateSet:true};
  const next=lunaTaskNextMetadata('unschedule',meta,'2026-10-20');
  assert.equal(next.time,''); assert.equal(next.reminder,false); assert.equal(next.recurrence,'none'); assert.equal(next.duration,90); assert.equal(next.estimateSet,true); assert.equal(next.note,'private');
  assert.equal(lunaTaskPatch(change('unschedule'),task).date,'');
  assert.equal(lunaTaskPatch(change('waiting'),task).date,task.date);
});

test('Unknown operations survive conversation and global deletion preflight',()=>{
 assert.equal(hasUnresolvedLunaAction(undefined),false);assert.equal(hasUnresolvedLunaAction({messages:[]}),false);
 assert.equal(hasUnresolvedLunaAction({messages:[{proposal:{status:'review',outcomeUnknown:true}}]}),true);
 assert.equal(hasUnresolvedLunaAction({messages:[{proposal:{status:'applied',outcomeUnknown:false}}]}),false);
});
