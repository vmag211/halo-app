import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const {historyFixture,fixtureCheckins,analyzeHistory,readingLabel,forecastFixture,seasonBounds}=await loadFrontend('week-evidence-preview');
const today='2026-10-12';
test('history fixture is absent by default and never fills missing mold or incomplete current day',()=>{
 assert.deepEqual(historyFixture(today,'unavailable'),[]);assert.deepEqual(historyFixture(today,'error'),[]);
 const rows=historyFixture(today,'populated');assert.equal(rows.length,336);assert.ok(rows.filter(r=>r.factor==='Outdoor mold').every(r=>r.value===null));assert.ok(rows.filter(r=>r.date===today).every(r=>r.value===null));
 assert.ok(rows.every(r=>r.source.includes('illustrative')&&r.issued.slice(0,10)<=today));
});
test('descriptive analysis distinguishes check-ins, history, comparable, recalled and illness',()=>{
 const entries=fixtureCheckins(today),rows=historyFixture(today,'populated');const report=analyzeHistory(entries,rows,'2026-07-21',today,'household','Air');
 assert.equal(report.logged,24);assert.equal(report.fine,12);assert.equal(report.recalled,1);assert.equal(report.illness,1);assert.ok(report.comparable<24);assert.ok(report.history>report.logged);assert.ok(report.enough);assert.equal(report.comparable,report.fineCount+report.symptomCount);
 assert.ok(report.joined.every(x=>!x.entry.recalled&&!x.entry.illness&&x.entry.date===x.reading.date));
});
test('group and range filters change all denominator joins instead of relabeling findings',()=>{
 const entries=fixtureCheckins(today),rows=historyFixture(today,'populated');assert.equal(analyzeHistory(entries,rows,'2026-10-01',today,'adult','Air').logged,0);
 const recent=analyzeHistory(entries,rows,'2026-10-05',today,'household','Air');assert.equal(recent.logged,8);assert.equal(recent.rows.length,8);assert.ok(recent.comparable<recent.logged);
});
test('unlogged days do not count as fine, category values remain categories, zero is preserved',()=>{
 const rows=historyFixture(today,'populated');const report=analyzeHistory([],rows,'2026-09-01',today,'household','Air');assert.equal(report.fine,0);assert.equal(report.comparable,0);assert.equal(report.enough,false);
 assert.equal(readingLabel({...rows[0],factor:'Air',value:0}),'0 AQI');assert.equal(readingLabel({...rows[0],factor:'Pollen',value:2}),'Moderate');assert.equal(readingLabel({...rows[0],value:null}),'Unavailable');
});
test('changed measurement basis is excluded and sparse coverage stays sparse',()=>{
 const entries=Array.from({length:84},(_,i)=>({date:historyFixture(today,'changed')[i*4].date,band:'household',fine:i%2===0,recalled:false,illness:false,symptoms:['Sneezing']}));const changed=analyzeHistory(entries,historyFixture(today,'changed'),'2026-07-21',today,'household','Air');assert.ok(changed.incompatible>30);assert.ok(changed.joined.every(x=>x.reading.version==='history-v1'));assert.ok(changed.comparable<42);
 const sparse=analyzeHistory(fixtureCheckins(today),historyFixture(today,'sparse'),'2026-07-21',today,'household','Air');assert.equal(sparse.enough,false);
});
test('flat readings support an honest no-difference state',()=>{const r=analyzeHistory(fixtureCheckins(today),historyFixture(today,'no-pattern'),'2026-07-21',today,'household','Air');assert.ok(r.enough);assert.equal(r.symptomMean,40);assert.equal(r.fineMean,40);});
test('forecasts expose partial periods, daily category and changed version instead of safe-time score',()=>{assert.deepEqual(forecastFixture(today,'unavailable'),[]);const rows=forecastFixture(today,'partial');assert.equal(rows[1].uv,null);assert.equal(rows[2].air,null);assert.ok(rows.every(r=>r.pollen==='Moderate'));assert.equal(forecastFixture(today,'changed')[1].version,'forecast-v2');assert.equal(forecastFixture(today,'changed')[1].air,82);});
test('seasons cross years and leap years without shifting all-day dates',()=>{assert.deepEqual(seasonBounds('Winter','2027'),{start:'2027-12-01',end:'2028-02-29'});assert.deepEqual(seasonBounds('Fall','2026'),{start:'2026-09-01',end:'2026-11-30'});});
