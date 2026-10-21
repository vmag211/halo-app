import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';

const {clearHomeDraft}=await loadFrontend('home-drafts');

test('a confirmed save removes its exact submitted draft without mutating the prior state',()=>{
 const submitted={title:'Submitted thought',description:'Original writing'};
 const unrelated={title:'A different project'};
 const previous={'explore:note:new':submitted,project:unrelated};
 const next=clearHomeDraft(previous,'explore:note:new',submitted);
 assert.deepEqual(next,{project:unrelated});
 assert.equal(previous['explore:note:new'],submitted);
 assert.equal(next.project,unrelated);
});

test('a delayed save never clears newer writing, even if the new object has identical text',()=>{
 const submitted={title:'Submitted thought',description:'Original writing'};
 for(const newer of [{...submitted,description:'Newer writing'},{...submitted}]){
  const previous={'explore:note:new':newer};
  assert.equal(clearHomeDraft(previous,'explore:note:new',submitted),previous);
  assert.equal(previous['explore:note:new'],newer);
 }
});

test('starter and evidence cleanup keeps newer incoming context and old unconditional callers work',()=>{
 const oldEvidence={recordId:'old-record'},newEvidence={recordId:'new-record'};
 const previous={starter:'New incoming question',evidence:newEvidence};
 assert.equal(clearHomeDraft(previous,'starter','Earlier question'),previous);
 assert.equal(clearHomeDraft(previous,'evidence',oldEvidence),previous);
 assert.deepEqual(clearHomeDraft(previous,'starter','New incoming question'),{evidence:newEvidence});
 assert.deepEqual(clearHomeDraft(previous,'evidence'),{starter:'New incoming question'});
 assert.equal(clearHomeDraft(previous,'missing'),previous);
 assert.equal(clearHomeDraft(previous,'starter',undefined),previous);
});
