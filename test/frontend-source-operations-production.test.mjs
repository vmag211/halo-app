import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadFrontend} from './frontend-test-loader.mjs';
import {readFileSync} from 'node:fs';
const {sourceOperationFixtures,applySourceOperation}=await loadFrontend('source-operations-preview');
const {validSourceOpsSnapshot,validSourceOpsHistory,sourceOpsError,sourceReceiptCoversCommand}=await loadFrontend('production/source-operations-service');
const sources=()=>sourceOperationFixtures().map(source=>({...source,allowedDecisions:['approve','quarantine','publish','withdraw','translation','retry','rollback','publish-translation'],publishedTranslations:[],versionsCursor:null,auditCursor:null}));
const snapshot=(role='publisher')=>({role,revision:1,sources:sources(),unresolvedOperations:[],nextCursor:null});
const command=(source,decision='approve')=>({operationId:'operation-1',sourceId:source.id,sourceRevision:source.revision,target:source.candidateId,decision,reason:'Source schema and published guidance reviewed.',recordedAt:'2026-10-13T12:00:00Z',snapshotRevision:1});
test('source access never accepts unknown roles or private records in a denied response',()=>{
 assert.equal(validSourceOpsSnapshot(snapshot()),true);assert.equal(validSourceOpsSnapshot(snapshot('admin')),false);assert.equal(validSourceOpsSnapshot(snapshot('denied')),false);assert.equal(validSourceOpsSnapshot({...snapshot('denied'),sources:[]}),true);
 assert.equal(validSourceOpsSnapshot({...snapshot(),unresolvedOperations:undefined}),false);
 assert.equal(validSourceOpsSnapshot({...snapshot(),sources:[{...sources()[0],url:'javascript:alert(1)'}]}),false);
 assert.equal(validSourceOpsSnapshot({...snapshot(),sources:[{...sources()[0],versions:[{}]}]}),false);
});
test('source decisions enforce role, exact revision, reason and validation separately from receipt authority',()=>{
 const source=sources()[0],operation=command(source);assert.equal(sourceOpsError(source,operation,'reviewer'),null);
 for(const role of ['denied','viewer'])assert.ok(sourceOpsError(source,operation,role));
 assert.ok(sourceOpsError(source,{...operation,sourceRevision:2},'publisher'));assert.ok(sourceOpsError(source,{...operation,reason:'yes'},'publisher'));
 assert.ok(sourceOpsError(source,{...operation,decision:'publish'},'reviewer'));assert.ok(sourceOpsError(source,{...operation,decision:'publish'},'publisher'),'approval must precede publication');
 const broken=sources()[1];assert.ok(sourceOpsError(broken,command(broken),'publisher'));assert.equal(sourceOpsError(broken,command(broken,'quarantine'),'reviewer'),null);
});
test('canonical source success must identify the exact decision in immutable audit and its final state',()=>{
 const source=sources()[0],operation=command(source),result=applySourceOperation(source,{...operation,requestId:operation.operationId},'reviewer');
 const next={...snapshot('reviewer'),revision:2,sources:[{...result.source,allowedDecisions:source.allowedDecisions,publishedTranslations:[],versionsCursor:null,auditCursor:null}]};
 const receipt={operationId:operation.operationId,status:'succeeded',snapshot:next};assert.equal(sourceReceiptCoversCommand(receipt,operation),true);
 assert.equal(sourceReceiptCoversCommand({...receipt,operationId:'other'},operation),false);
 assert.equal(sourceReceiptCoversCommand({...receipt,snapshot:snapshot()},operation),false);
 assert.equal(sourceReceiptCoversCommand({...receipt,snapshot:{...next,sources:[{...next.sources[0],audit:[]}]}},operation),false);
});
test('rollback and translated publication remain separate version-bound publisher decisions',()=>{
 const source=sources()[0],historical={...source.versions[0],id:'guide-1',status:'superseded'};source.versions.push(historical);
 const restore={...command(source),decision:'rollback',target:'guide-1'};assert.equal(sourceOpsError(source,restore,'publisher'),null);assert.ok(sourceOpsError(source,restore,'reviewer'));
 const translated={...command(source),decision:'publish-translation',target:source.publishedId,locale:'es'};assert.ok(sourceOpsError(source,translated,'publisher'));source.versions[0].translation='approved';assert.equal(sourceOpsError(source,translated,'publisher'),null);assert.ok(sourceOpsError(source,{...translated,target:source.candidateId},'publisher'));
});
test('history pagination carries exact source revision and cannot smuggle malformed audit rows',()=>{
 const value={sourceId:'guidance',sourceRevision:1,kind:'versions',versions:sources()[0].versions,audit:[],nextCursor:'next-page'};assert.equal(validSourceOpsHistory(value),true);assert.equal(validSourceOpsHistory({...value,sourceRevision:0}),false);assert.equal(validSourceOpsHistory({...value,audit:[{reason:'not enough'}]}),false);
 const production=readFileSync(new URL('../components/production/ProductionSourceOperations.tsx',import.meta.url),'utf8');assert.doesNotMatch(production,/sourceOperationFixtures|applySourceOperation|setTimeout/);assert.match(production,/sourceReceiptCoversCommand/);assert.match(production,/domain:'source-operations'/);
 const auth=readFileSync(new URL('../components/production/OperatorAccess.tsx',import.meta.url),'utf8');assert.doesNotMatch(auth,/signInAnonymously|signUp|service_role|SERVICE_ROLE/);
 assert.match(auth,/setTimeout\([\s\S]*8000\)/);assert.match(auth,/if\(!active\|\|!pending\)return/);assert.match(auth,/active=false;pending=false;clearTimeout\(timer\);unsubscribe/);assert.match(auth,/Retry access/);
});
