import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const model=await loadFrontend('account-review');
const {selectedPrivateExport}=await loadFrontend('settings-preview');
test('home lookup validates area input without pretending to geocode it',()=>{
 for(const value of ['28025','Concord','San Juan',' Montréal '])assert.equal(model.validArea(value),true);
 for(const value of ['','1','123','123456','<city>','city\nstate','x'.repeat(101)])assert.equal(model.validArea(value),false);
});
test('recovery validates and masks addresses, never resolves identity',()=>{
 assert.equal(model.validRecoveryEmail('a@example.test'),true);assert.equal(model.maskedEmail('private@example.test'),'p•••@example.test');
 for(const value of ['abc','a@b','a b@x.org','x@y.org '+ 'x'.repeat(255)])assert.equal(model.validRecoveryEmail(value),false);
});
test('only personal independent actions can be carried into a new home context',()=>{
 for(const value of ['Personal','manual','My Week'])assert.equal(model.eligiblePortable(value),true);
 for(const value of ['Test','Project','Home care','Community','Outdoors'])assert.equal(model.eligiblePortable(value),false);
 assert.equal(model.currentHomeId([]),'sample-current-home');assert.equal(model.currentHomeId([{id:'first'},{id:'last'}]),'last');
});
test('task export includes owned date metadata but excludes places, preparation and orphan metadata',()=>{
 const output=selectedPrivateExport({collections:{},actions:[{id:'1',key:'owned',title:'A task'}],drafts:{'week:metas':{owned:{zone:'America/Phoenix',start:'09:00',end:'10:00',preparation:{body:'private'},place:'my home',history:[{at:'2026-10-12',date:'2026-10-13'}]},orphan:{start:'12:00'}}},groups:['tasks'],privateText:false});
 assert.deepEqual(Object.keys(output.taskDetails),['owned']);assert.equal(output.taskDetails.owned.zone,'America/Phoenix');assert.equal(output.taskDetails.owned.history.length,1);assert.equal(output.taskDetails.owned.preparation,undefined);assert.equal(output.taskDetails.owned.place,undefined);
});
test('generic exports never embed image bytes or exact locations even with private text opt-in',()=>{
 const output=selectedPrivateExport({collections:{observations:[{id:'x',revision:1,title:'Observation',photoData:'data:raw',photoName:'street.jpg',photo:{data:'sanitized'},area:'precise area',notes:'chosen text'}]},actions:[],drafts:{},groups:['home'],privateText:true});
 const record=output.home.observations[0];assert.equal(record.notes,'chosen text');for(const key of ['photo','photoData','photoName','area'])assert.equal(record[key],undefined);
});
