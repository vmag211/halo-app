import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
const {validLunaConversation,validLunaEvidence}=await loadFrontend('production/luna-service');
const source={title:'Local air monitor',url:'https://www.airnow.gov/'};
const fact={kind:'fact',text:'The source reports a reading.',sourceIndexes:[0],scope:'Outdoor monitor, not indoor air',observedAt:'2026-10-15T12:00:00Z'};
const conversation=message=>({id:'c',revision:1,messages:[{id:'m',role:'assistant',text:'Here is what we know.',...message}]});
test('Luna accepts legacy answers and explicitly source-bound findings without changing tool authority',()=>{
 assert.equal(validLunaConversation(conversation({sources:[source]})),true);
 assert.equal(validLunaConversation(conversation({sources:[source],evidence:[fact,{kind:'interpretation',text:'This may help with your planning.',sourceIndexes:[0]},{kind:'next-step',text:'Check conditions before leaving.',sourceIndexes:[]}]})),true);
});
test('Luna rejects unsupported facts, invalid citation references and ambiguous dates',()=>{
 for(const block of [{...fact,sourceIndexes:[]},{...fact,sourceIndexes:[1]},{...fact,sourceIndexes:[-1]},{...fact,sourceIndexes:[0,0]},{...fact,sourceIndexes:[.5]},{...fact,observedAt:'2026-10-15'},{...fact,observedAt:'not a date'},{...fact,kind:'verified'},{...fact,text:''}])assert.equal(validLunaEvidence([block],1),false);
 assert.equal(validLunaConversation(conversation({evidence:[fact]})),false);
 assert.equal(validLunaConversation(conversation({role:'user',sources:[source],evidence:[fact]})),false);
 assert.equal(validLunaConversation(conversation({sources:[{...source,url:'javascript:alert(1)'}],evidence:[fact]})),false);
 for(const observedAt of ['2026-02-30T12:00:00Z','2026-10-15T24:00:00Z','2026-10-15T12:00:00','2026-10-15T12:00:00+99:00'])assert.equal(validLunaEvidence([{...fact,observedAt}],1),false);
});
