import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {recordFingerprint,actionFingerprint,selectedPrivateExport,alertSeed,changeAlert,mergeUnedited}=await loadFrontend('settings-preview');
test('conflict rebase preserves edited fields and adopts fresh unedited flags',()=>{
 const baseline={home:{year:'2000',water:'utility'},household:{adult:true,child:false}};
 const draft={home:{year:'2001',water:'utility'},household:{adult:false,child:false}};
 const fresh={home:{year:'2000',water:'well'},household:{adult:true,child:true}};
 assert.deepEqual(mergeUnedited(draft,baseline,fresh),{home:{year:'2001',water:'well'},household:{adult:false,child:true}});
});
test('privacy fingerprints bind deletion to exact records and revisions, independently of order',()=>{
 const a={tests:[{id:'a',revision:1}],weekJournal:[{id:'j',revision:2}]};assert.equal(recordFingerprint(a,'all'),recordFingerprint({weekJournal:a.weekJournal,tests:a.tests},'all'));assert.notEqual(recordFingerprint(a,'all'),recordFingerprint({...a,tests:[{id:'a',revision:2}]},'all'));assert.equal(recordFingerprint(a,'journal'),recordFingerprint({...a,tests:[]},'journal'));assert.notEqual(actionFingerprint([{id:'a',revision:1}]),actionFingerprint([{id:'a',revision:2}]));
});
test('selected export redacts nested private text/location/attachments and never includes unselected domains',()=>{
 const input={collections:{tests:[{id:'a',revision:1,title:'Owned',note:'PRIVATE',address:'ADDRESS',rows:[{lat:1,body:'PRIVATE',value:0}],files:['FILE']}],weekJournal:[{id:'j',revision:1,note:'PRIVATE',symptoms:['PRIVATE']}]},actions:[],drafts:{'luna:conversation':{messages:[{text:'PRIVATE'}]}},groups:['home','conversation'],privateText:false};const serialized=JSON.stringify(selectedPrivateExport(input));assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes('ADDRESS'));assert.ok(!serialized.includes('FILE'));assert.ok(serialized.includes('"value":0'));assert.ok(!serialized.includes('"journal"'));assert.ok(serialized.includes('isolated-wireframe'));assert.ok(serialized.includes('authoritative":false'));const opted=JSON.stringify(selectedPrivateExport({...input,privateText:true}));assert.ok(opted.includes('PRIVATE'));assert.ok(!opted.includes('ADDRESS'));
});
test('alerts use one canonical unread/read/dismiss revision without changing read status on dismissal',()=>{
 const all=alertSeed(3);assert.equal(all.length,3);assert.equal(alertSeed(0).length,0);assert.equal(new Set(alertSeed(12).map(a=>a.id)).size,12);const read=changeAlert(all,all[0].id,1,{read:true});assert.equal(read[0].revision,2);assert.equal(changeAlert(read,all[0].id,1,{dismissed:true}),null);const dismissed=changeAlert(read,all[1].id,1,{dismissed:true});assert.equal(dismissed[1].read,false);const restored=changeAlert(dismissed,all[1].id,2,{dismissed:false});assert.equal(restored[1].read,false);assert.equal(restored[1].revision,3);
});
