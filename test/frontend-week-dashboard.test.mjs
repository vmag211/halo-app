import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {weekDashboard,effortLabel}=await loadFrontend('week-dashboard');
const {emptyWeekMeta}=await loadFrontend('week-preview');
const action=(id,date='2026-10-12',origin='Personal',state='saved')=>({id,key:`personal:${id}`,title:id,date,origin,state,reason:'Owned',revision:1});
const meta=(patch={})=>({...emptyWeekMeta,...patch});
const record=(id,date='2026-10-12',category='Home')=>({id,title:id,date,category,kind:'routine',destination:'maintenance',view:'detail',recordId:id});

test('dashboard counts canonical plans and linked dates separately without reading private records',()=>{
  const actions=[action('a'),action('b','2026-10-14','Project')];
  const records=[record('r'),record('r'),record('outside','2026-11-01')];
  const before=JSON.stringify([actions,records]);const result=weekDashboard(actions,{},records,'2026-10-12','America/New_York');
  assert.equal(result.plans,2);assert.equal(result.records,1);assert.equal(result.unknown,2);assert.equal(result.minutes,0);assert.equal(result.days.length,7);assert.equal(result.kinds.Home,1);assert.equal(result.kinds.Projects,1);assert.equal(JSON.stringify([actions,records]),before);
});
test('default, invalid or unsupported durations never become supplied effort',()=>{
  const actions=[action('default'),action('known'),action('bad'),action('invalid-clock')];
  const metas={'personal:known':meta({estimateSet:true,duration:45}),'personal:bad':meta({estimateSet:true,duration:10}),'personal:invalid-clock':meta({time:'99:00',estimateSet:true,duration:60})};
  const result=weekDashboard(actions,metas,[],'2026-10-12','America/New_York');assert.equal(result.minutes,45);assert.equal(result.unknown,3);
});
test('timed overnight effort is split at actual display-zone day boundaries',()=>{
  const result=weekDashboard([action('night')],{'personal:night':meta({time:'23:30',zone:'America/New_York',duration:90})},[],'2026-10-12','America/New_York');
  assert.equal(result.plans,1);assert.equal(result.minutes,90);assert.equal(result.days[0].minutes,30);assert.equal(result.days[1].minutes,60);assert.equal(result.days[1].plans,1);assert.equal(result.unknown,0);
});
test('a task starting before this week can continue into the week without duplicated task totals',()=>{
  const result=weekDashboard([action('night','2026-10-11')],{'personal:night':meta({time:'23:30',zone:'America/New_York',duration:90})},[],'2026-10-12','America/New_York');
  assert.equal(result.plans,1);assert.equal(result.minutes,60);assert.equal(result.days[0].plans,1);
});
test('timezone display preserves all-day dates and moves only actual timed instants',()=>{
  const result=weekDashboard([action('timed'),action('all-day')],{'personal:timed':meta({time:'01:00',zone:'UTC',duration:60})},[],'2026-10-12','Pacific/Honolulu');
  assert.equal(result.plans,1);assert.equal(result.days[0].plans,1);assert.equal(result.unknown,1);assert.equal(result.minutes,0);
});
test('paused and archived plans are absent and done uses recorded completion dates',()=>{
  const actions=[action('paused'),action('archived'),action('done','2026-09-01','Personal','completed'),action('unknown','2026-10-12','Personal','completed')];
  const result=weekDashboard(actions,{'personal:paused':meta({paused:true}),'personal:archived':meta({archived:true}),'personal:done':meta({completedOn:'2026-10-14'})},[],'2026-10-12','America/New_York');
  assert.equal(result.plans,0);assert.equal(result.completed,1);assert.equal(result.days[2].completed,1);assert.equal(result.minutes,0);
});
test('overlapping durations remain additive effort, not a fabricated free-time calculation',()=>{
  const result=weekDashboard([action('a'),action('b')],{'personal:a':meta({time:'09:00',duration:60}),'personal:b':meta({time:'09:30',duration:60})},[],'2026-10-12','America/New_York');assert.equal(result.minutes,120);assert.equal(result.plans,2);
});
test('invalid anchors are unavailable and effort labels do not imply time spent',()=>{assert.equal(weekDashboard([action('a')],{},[],'2026-02-30','UTC').days.length,0);assert.equal(effortLabel(45),'45m');assert.equal(effortLabel(75),'1h 15m');assert.equal(effortLabel(120),'2h');});
