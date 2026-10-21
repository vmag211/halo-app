import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadFrontend} from './frontend-test-loader.mjs';
const {createProductionRuntime}=await loadFrontend('production/runtime');
const {collectionView,journalOffMessage}=await loadFrontend('collection-availability');
const credential=async()=>({identityId:'owner-1',accessToken:'test-token'});
const make=fetcher=>createProductionRuntime({identityId:'owner-1',homeContextId:'home-1',credential,fetcher});
const off={error:'Saving Homeguard records is not available yet. Nothing was saved.',code:'feature_unavailable',message:'Saving Homeguard records is not available yet. Nothing was saved.',field_errors:[],retryable:false,request_id:'r'};

// Transcribed from HomeWorkspaceState.loadCollection's catch (drift test below).
const failedState=error=>({status:'error',complete:false,featureUnavailable:error?.reason==='feature_unavailable',message:error instanceof Error?error.message.replaceAll('—',','):'This collection could not load. Try again.'});
async function loadError(fetcher){try{await make(fetcher).request('workspace.load',{collection:'weekJournal'});}catch(error){return error;}assert.fail('expected a failure');}

test('a read refused with 503 feature_unavailable shows "not available yet" with no retry',async()=>{
  const error=await loadError(async()=>Response.json(off,{status:503}));
  assert.equal(error.code,'unavailable');assert.equal(error.reason,'feature_unavailable');
  assert.doesNotMatch(error.message,/Homeguard records/,'server wording is not echoed');
  assert.equal(collectionView(failedState(error)),'off');
  assert.doesNotMatch(journalOffMessage,/—/);assert.match(journalOffMessage,/not available yet/);
});

test('a real outage, other 5xx or network failure still shows the error and Try again',async()=>{
  for(const fetcher of [
    async()=>Response.json({error:'x',code:'upstream_unavailable',message:'x',retryable:true},{status:503}),
    async()=>new Response('gateway down',{status:503}),
    async()=>Response.json({...off},{status:500}),
    async()=>Response.json({error:'x',code:'internal_error'},{status:502}),
    async()=>{throw new TypeError('Failed to fetch');},
  ]){
    const error=await loadError(fetcher);
    assert.equal(error.reason,undefined);
    assert.equal(collectionView(failedState(error)),'error');
  }
});

test('a mutation refused with feature_unavailable keeps its existing unknown-outcome authority',async()=>{
  const runtime=make(async()=>Response.json(off,{status:503}));
  await assert.rejects(runtime.request('workspace.execute',{kind:'save'},{idempotencyKey:'op-1'}),e=>e.code==='unknown_outcome'&&e.reason===undefined);
});

test('loading and ready states are unchanged',()=>{
  assert.equal(collectionView(undefined),'loading');
  assert.equal(collectionView({status:'loading',featureUnavailable:true}),'loading');
  assert.equal(collectionView({status:'ready',featureUnavailable:true}),'ready');
});

test('drift: the transcribed catch matches HomeWorkspaceState',()=>{
  const source=readFileSync(new URL('../components/homeguard/HomeWorkspaceState.tsx',import.meta.url),'utf8');
  assert.ok(source.includes("status: 'error', complete: false, featureUnavailable: (error as { reason?: unknown } | null)?.reason === 'feature_unavailable', message: error instanceof Error ? error.message.replaceAll('\\u2014', ',') : 'This collection could not load. Try again.'"));
  const journal=readFileSync(new URL('../components/expanded/WeekJournal.tsx',import.meta.url),'utf8');
  assert.ok(journal.includes("{view!=='off'&&<button"),'no Try again when the feature is off');
});

test('an upload refused up front with 403 feature_unavailable stays a settled permission failure, marked off',async()=>{
  const runtime=make(async()=>Response.json({...off,error:'Private files are not available yet. Nothing was saved.'},{status:403}));
  await assert.rejects(runtime.request('attachments.upload',{},{idempotencyKey:'op-2'}),e=>e.code==='permission'&&e.reason==='feature_unavailable');
  const other=make(async()=>Response.json({error:'x',code:'forbidden',message:'x'},{status:403}));
  await assert.rejects(other.request('attachments.upload',{},{idempotencyKey:'op-3'}),e=>e.code==='permission'&&e.reason===undefined);
});
