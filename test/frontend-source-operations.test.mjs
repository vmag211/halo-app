import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFrontend } from './frontend-test-loader.mjs';
const { sourceOperationFixtures, sourceOperationTarget, sourceOperationError, applySourceOperation, sourceEvidenceLabels } = await loadFrontend('source-operations-preview');
let serial=0;
const prepare=(source,decision,patch={})=>({sourceId:source.id,sourceRevision:source.revision,target:sourceOperationTarget(source,decision),decision,requestId:`review-${++serial}`,reason:'Reviewed the exact source and its safe diagnostic comparison.',recordedAt:'2026-10-12T16:00:00Z',...patch});

test('Operators have separated read, review and publication authority at commit',()=>{
 const [source]=sourceOperationFixtures();const request=prepare(source,'approve');
 for(const role of ['denied','viewer','owner','admin',null,undefined]) assert.match(sourceOperationError(source,request,role),/role/);
 const approved=applySourceOperation(source,request,'reviewer').source;
 const publish=prepare(approved,'publish');assert.match(sourceOperationError(approved,publish,'reviewer'),/role/);
 assert.equal(sourceOperationError(approved,publish,'publisher'),null);
});
test('Malformed, unexpectedly empty, unit and coverage changes cannot be published by checking a box',()=>{
 const source=sourceOperationFixtures()[1];
 for(const decision of ['approve','publish','translation']) assert.match(sourceOperationError(source,prepare(source,decision),'publisher'),/validation/);
 const next=applySourceOperation(source,prepare(source,'quarantine'),'reviewer').source;
 assert.equal(next.versions.find(v=>v.id===next.candidateId).status,'quarantined');
 assert.equal(next.publishedId,'water-5');assert.equal(next.versions[0],source.versions[0]);
 assert.match(sourceOperationError(next,prepare(next,'approve'),'publisher'),/validation/);
});
test('Exact reviewed publication preserves superseded history and withdrawal keeps owned data outside scope',()=>{
 let [source]=sourceOperationFixtures();assert.match(sourceOperationError(source,prepare(source,'publish'),'publisher'),/approved/);
 source=applySourceOperation(source,prepare(source,'approve'),'reviewer').source;
 source=applySourceOperation(source,prepare(source,'publish'),'publisher').source;
 assert.equal(source.publishedId,'guide-3');assert.equal(source.candidateId,null);assert.equal(source.versions[0].status,'superseded');
 source=applySourceOperation(source,prepare(source,'withdraw'),'publisher').source;
 assert.equal(source.publishedId,null);assert.equal(source.versions.length,2);assert.equal(source.versions[1].status,'withdrawn');
 assert.equal(source.audit.length,3);assert.equal(source.audit[2].recordedAt,'2026-10-12T16:00:00Z');
 assert.ok(!('household' in source));
});
test('Stale source revision, wrong target, missing reason and repeat request cannot mutate source',()=>{
 const [source]=sourceOperationFixtures();const request=prepare(source,'approve');
 for(const patch of [{sourceRevision:9},{target:'other'},{sourceId:'other'},{reason:''},{recordedAt:'invalid'}]) { const result=applySourceOperation(source,{...request,...patch},'publisher');assert.equal(result.source,source);assert.ok(result.error); }
 const saved=applySourceOperation(source,request,'reviewer');const again=applySourceOperation(saved.source,request,'reviewer');
 assert.equal(again.source,saved.source);assert.match(again.error,/already/);assert.equal(again.source.audit.length,1);
});
test('Retry is scoped and idempotent, retaining the stale last valid publication even after an empty retry',()=>{
 const source=sourceOperationFixtures()[2];const request=prepare(source,'retry');const next=applySourceOperation(source,request,'reviewer').source;
 assert.equal(next.run.id,source.run.id);assert.equal(next.run.requestKey,source.run.requestKey);assert.equal(next.run.attempts,2);
 assert.equal(next.publishedId,source.publishedId);assert.deepEqual(next.versions,source.versions);assert.equal(next.freshness,'stale');assert.equal(next.candidateId,null);
 assert.equal(applySourceOperation(next,request,'reviewer').source,next);
 assert.match(sourceOperationError(next,prepare(next,'retry'),'reviewer'),/Only a failed/);
});
test('Translations stay version bound and unpublished until the exact approved content is reviewed',()=>{
 let [source]=sourceOperationFixtures();assert.match(sourceOperationError(source,prepare(source,'translation'),'reviewer'),/matching source/);
 source=applySourceOperation(source,prepare(source,'approve'),'reviewer').source;const request=prepare(source,'translation');
 const next=applySourceOperation(source,request,'reviewer').source;
 assert.equal(next.publishedId,'guide-2');assert.equal(next.versions[1].translation,'approved');assert.equal(next.versions[0].translation,'not-requested');
 assert.match(sourceOperationError({...source,revision:99},request,'reviewer'),/revision changed/);
});
test('Zero, non-detect, unavailable, partial and invalid states remain distinct, and fixtures are isolated',()=>{
 assert.equal(new Set(Object.values(sourceEvidenceLabels)).size,6);
 const fixtures=sourceOperationFixtures();fixtures[0].versions[0].count=99;assert.equal(sourceOperationFixtures()[0].versions[0].count,3);
 for(const source of fixtures) assert.ok(new URL(source.url).hostname==='example.org');
});
